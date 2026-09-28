// workers/live-hub/src/game-room.ts
// One Durable Object per game (Live v2 spec §6.1). Keeps the last ~150 s of
// published messages in SQLite so a new or reconnecting fan can rebuild state
// from a keyframe, and relays every new message to all connected sockets.
// Sockets use the Hibernation API: an idle room costs nothing.

import { DurableObject } from 'cloudflare:workers';

export const REPLAY_WINDOW_MS = 150_000;
export const IDLE_CLEANUP_MS = 6 * 60 * 60_000;
/** Only move the idle alarm when it would land this much later: one storage write per hour, not per publish. */
const ALARM_SLACK_MS = 60 * 60_000;
export const RESYNC_MIN_INTERVAL_MS = 5_000;

type Attachment = { lastResync?: number };

export function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
}

type Parsed =
  | { kind: 'keyframe'; seq: number; fetchedMs: number; msg: Record<string, unknown> }
  | { kind: 'delta'; seq: number; baseSeq: number; msg: Record<string, unknown> };

function parseMessage(raw: string): Parsed | 'bad json' | 'bad message' {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return 'bad json';
  }
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return 'bad message';
  const m = msg as Record<string, unknown>;
  if (!Number.isInteger(m.seq)) return 'bad message';
  const seq = m.seq as number;
  if (m.kind === 'delta') {
    return Number.isInteger(m.base_seq) ? { kind: 'delta', seq, baseSeq: m.base_seq as number, msg: m } : 'bad message';
  }
  if (m.kind === 'keyframe') {
    const doc = m.doc as { fetched_at?: unknown } | null | undefined;
    const fetchedMs = typeof doc === 'object' && doc !== null && typeof doc.fetched_at === 'string' ? Date.parse(doc.fetched_at) : NaN;
    return Number.isFinite(fetchedMs) ? { kind: 'keyframe', seq, fetchedMs, msg: m } : 'bad message';
  }
  return 'bad message';
}

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, at_ms INTEGER NOT NULL, fetched_ms INTEGER, body TEXT NOT NULL)'
    );
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    if (isWebSocketUpgrade(request)) return this.acceptSocket();
    if (request.method === 'POST' && new URL(request.url).pathname === '/publish') {
      return this.publish(await request.text());
    }
    return new Response('not found', { status: 404 });
  }

  private acceptSocket(): Response {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    for (const body of this.replay()) server.send(body);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async publish(raw: string): Promise<Response> {
    const parsed = parseMessage(raw);
    if (typeof parsed === 'string') return new Response(parsed, { status: 400 });
    const sql = this.ctx.storage.sql;
    const max = sql.exec<{ seq: number | null }>('SELECT max(seq) AS seq FROM messages').one().seq;

    if (parsed.kind === 'delta') {
      // A delta only extends the stream it was diffed against.
      if (max === null || parsed.baseSeq !== max || parsed.seq <= max) return new Response('stale delta', { status: 409 });
    } else if (max !== null && parsed.seq <= max) {
      // A restarted runner continues from the database's seq, which can be behind
      // what it already published: a lower-seq keyframe fetched later than our
      // newest keyframe starts a new epoch. One fetched earlier is a late retry.
      const newest = sql
        .exec<{ fetched_ms: number | null }>("SELECT fetched_ms FROM messages WHERE kind = 'keyframe' ORDER BY seq DESC LIMIT 1")
        .toArray()[0]?.fetched_ms ?? null;
      if (newest !== null && parsed.fetchedMs <= newest) return new Response('stale keyframe', { status: 409 });
      sql.exec('DELETE FROM messages');
    }

    const now = Date.now();
    const body = JSON.stringify({ ...parsed.msg, hub_at: now });
    // Plain INSERT: after the checks above seq is always new, so nothing is ever replaced.
    sql.exec(
      'INSERT INTO messages (seq, kind, at_ms, fetched_ms, body) VALUES (?, ?, ?, ?, ?)',
      parsed.seq, parsed.kind, now, parsed.kind === 'keyframe' ? parsed.fetchedMs : null, body
    );
    this.prune(now);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(body);
      } catch {
        // The socket is closing; the runtime drops it.
      }
    }
    const target = now + IDLE_CLEANUP_MS;
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm < target - ALARM_SLACK_MS) await this.ctx.storage.setAlarm(target);
    return new Response(null, { status: 204 });
  }

  /** Drop everything before the newest keyframe that is already outside the replay window. */
  prune(now: number): void {
    const cut = this.ctx.storage.sql
      .exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM messages WHERE kind = 'keyframe' AND at_ms <= ?", now - REPLAY_WINDOW_MS)
      .one().seq;
    if (cut !== null) this.ctx.storage.sql.exec('DELETE FROM messages WHERE seq < ?', cut);
  }

  /** The oldest stored keyframe and every message after it, in order. */
  replay(): string[] {
    const first = this.ctx.storage.sql
      .exec<{ seq: number | null }>("SELECT min(seq) AS seq FROM messages WHERE kind = 'keyframe'")
      .one().seq;
    if (first === null) return [];
    return this.ctx.storage.sql
      .exec<{ body: string }>('SELECT body FROM messages WHERE seq >= ? ORDER BY seq', first)
      .toArray()
      .map((row) => row.body);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message !== 'resync') return;
    // The attachment survives hibernation, unlike an in-memory map.
    const att = (ws.deserializeAttachment() as Attachment | null) ?? {};
    const now = Date.now();
    if (att.lastResync !== undefined && now - att.lastResync < RESYNC_MIN_INTERVAL_MS) return;
    ws.serializeAttachment({ ...att, lastResync: now } satisfies Attachment);
    for (const body of this.replay()) ws.send(body);
  }

  // Complete the close handshake. The installed workerd (compat 2026-09-01) does
  // not answer a hibernated socket's close frame by itself: without this the
  // socket sits in CLOSING. close() rejects the reserved codes 1005 (no code),
  // 1006 (abnormal) and 1015 (TLS), which is how most real disconnects arrive.
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const reply = code === 1005 || code === 1006 || code === 1015 ? 1000 : code;
    try {
      ws.close(reply, reason);
    } catch {
      // Already closed; nothing to answer.
    }
  }

  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM messages');
  }
}
