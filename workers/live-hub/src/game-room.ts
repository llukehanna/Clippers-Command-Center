// workers/live-hub/src/game-room.ts
// One Durable Object per game (Live v2 spec §6.1). Keeps the last ~150 s of
// published messages in SQLite so a new or reconnecting fan can rebuild state
// from a keyframe, and relays every new message to all connected sockets.
// Sockets use the Hibernation API: an idle room costs nothing.

import { DurableObject } from 'cloudflare:workers';

export const REPLAY_WINDOW_MS = 150_000;
export const IDLE_CLEANUP_MS = 6 * 60 * 60_000;

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, at_ms INTEGER NOT NULL, body TEXT NOT NULL)'
    );
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') return this.acceptSocket();
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
    let msg: { kind?: unknown; seq?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return new Response('bad json', { status: 400 });
    }
    if ((msg.kind !== 'keyframe' && msg.kind !== 'delta') || !Number.isInteger(msg.seq)) {
      return new Response('bad message', { status: 400 });
    }
    const seq = msg.seq as number;
    const now = Date.now();
    // A restarted runner continues from the database's seq, which can be
    // behind what it already published: its first keyframe starts a new epoch.
    const max = this.ctx.storage.sql.exec<{ seq: number | null }>('SELECT max(seq) AS seq FROM messages').one().seq;
    if (msg.kind === 'keyframe' && max !== null && seq <= max) this.ctx.storage.sql.exec('DELETE FROM messages');

    const body = JSON.stringify({ ...msg, hub_at: now });
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO messages (seq, kind, at_ms, body) VALUES (?, ?, ?, ?)',
      seq, msg.kind, now, body
    );
    this.prune(now);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(body);
      } catch {
        // The socket is closing; the runtime drops it.
      }
    }
    await this.ctx.storage.setAlarm(now + IDLE_CLEANUP_MS);
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
    if (message === 'resync') for (const body of this.replay()) ws.send(body);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM messages');
  }
}
