import { env } from 'cloudflare:workers';
import { createExecutionContext, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker, { gameKey, isAllowedOrigin, type GameRoom } from '../src/index';

const AUTH = { Authorization: 'Bearer test-secret' };
const call = (req: Request) => worker.fetch(req, env, createExecutionContext());
const publish = (game: string, msg: unknown, headers: Record<string, string> = AUTH) =>
  call(new Request(`https://hub/publish/${game}`, { method: 'POST', headers, body: JSON.stringify(msg) }));
const keyframe = (seq: number, fetchedMs = Date.now()) => ({
  kind: 'keyframe',
  seq,
  doc: { seq, fetched_at: new Date(fetchedMs).toISOString() },
});
const delta = (seq: number) => ({ kind: 'delta', seq, base_seq: seq - 1, patch: {} });

async function openSocket(game: string, origin = 'http://localhost:3000', upgrade = 'websocket') {
  const res = await call(new Request(`https://hub/ws/${game}`, { headers: { Upgrade: upgrade, Origin: origin } }));
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const got: Array<{ kind: string; seq: number; hub_at: number }> = [];
  ws.addEventListener('message', (e) => { if (e.data !== 'pong') got.push(JSON.parse(e.data as string)); });
  ws.accept();
  return { ws, got };
}

async function until(check: () => boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('helpers', () => {
  it('normalizes game ids so 10-char and numeric ids share a room', () => {
    expect(gameKey('0022600093')).toBe('22600093');
    expect(gameKey('22600093')).toBe('22600093');
    expect(gameKey('abc')).toBeNull();
    expect(gameKey('0')).toBeNull();
  });

  it('allows only listed origins', () => {
    expect(isAllowedOrigin('http://localhost:3000', env.ALLOWED_ORIGINS)).toBe(true);
    expect(isAllowedOrigin('https://evil.example', env.ALLOWED_ORIGINS)).toBe(false);
    expect(isAllowedOrigin(null, env.ALLOWED_ORIGINS)).toBe(false);
  });
});

describe('http', () => {
  it('serves health', async () => {
    const res = await call(new Request('https://hub/health'));
    expect(res.status).toBe(200);
  });

  it('rejects publishes without the secret, with a bad id, or with a bad body', async () => {
    expect((await publish('1', keyframe(1), {})).status).toBe(401);
    expect((await publish('1', keyframe(1), { Authorization: 'Bearer nope' })).status).toBe(401);
    expect((await publish('nope', keyframe(1))).status).toBe(400);
    expect((await publish('1', { kind: 'other', seq: 1 })).status).toBe(400);
    expect((await publish('1', null)).status).toBe(400);
    expect((await publish('1', 7)).status).toBe(400);
    expect((await publish('1', [keyframe(1)])).status).toBe(400);
    const bad = await call(new Request('https://hub/publish/1', { method: 'POST', headers: AUTH, body: '{' }));
    expect(bad.status).toBe(400);
  });

  it('rejects sockets without an upgrade or from other origins', async () => {
    expect((await call(new Request('https://hub/ws/1'))).status).toBe(426);
    const res = await call(new Request('https://hub/ws/1', { headers: { Upgrade: 'websocket', Origin: 'https://evil.example' } }));
    expect(res.status).toBe(403);
  });
});

describe('GameRoom', () => {
  it('replays from the oldest keyframe to a new socket, stamped with hub_at', async () => {
    expect((await publish('101', keyframe(1))).status).toBe(204);
    await publish('101', delta(2));
    const { got } = await openSocket('101');
    await until(() => got.length === 2);
    expect(got.map((m) => [m.kind, m.seq])).toEqual([['keyframe', 1], ['delta', 2]]);
    expect(typeof got[0].hub_at).toBe('number');
  });

  it('broadcasts new messages to connected sockets, and replays on resync', async () => {
    await publish('102', keyframe(1));
    const { ws, got } = await openSocket('0000000102');
    await until(() => got.length === 1);
    await publish('102', delta(2));
    await until(() => got.length === 2);
    ws.send('resync');
    await until(() => got.length === 4);
    expect(got.map((m) => m.seq)).toEqual([1, 2, 1, 2]);
  });

  it('keeps the newest keyframe older than the window and everything after it', async () => {
    const stub = env.GAME_ROOM.getByName('103');
    await publish('103', keyframe(1));
    await runInDurableObject(stub, async (room: GameRoom, state) => {
      const old = Date.now() - 200_000;
      state.storage.sql.exec('DELETE FROM messages');
      const insert = (seq: number, kind: string, at: number) =>
        state.storage.sql.exec('INSERT INTO messages (seq, kind, at_ms, body) VALUES (?, ?, ?, ?)', seq, kind, at, JSON.stringify({ kind, seq }));
      insert(1, 'keyframe', old);
      insert(2, 'delta', old);
      insert(3, 'keyframe', old + 10_000);
      insert(4, 'delta', Date.now());
      room.prune(Date.now());
      expect(room.replay().map((b) => JSON.parse(b).seq)).toEqual([3, 4]);
    });
  });

  it('starts over when a restarted runner publishes a lower-seq keyframe', async () => {
    const t = Date.now();
    await publish('104', keyframe(50, t));
    await publish('104', delta(51));
    expect((await publish('104', keyframe(3, t + 5_000))).status).toBe(204);
    const { got } = await openSocket('104');
    await until(() => got.length === 1);
    expect(got.map((m) => m.seq)).toEqual([3]);
  });

  it('accepts the Upgrade header in any case', async () => {
    await publish('106', keyframe(1));
    const { got } = await openSocket('106', 'http://localhost:3000', 'WebSocket');
    await until(() => got.length === 1);
  });

  it('keeps publishing after clients close, with or without a close code', async () => {
    await publish('107', keyframe(1));
    const a = await openSocket('107');
    const b = await openSocket('107');
    await until(() => a.got.length === 1 && b.got.length === 1);
    const closed = (ws: WebSocket) => new Promise<void>((r) => ws.addEventListener('close', () => r()));
    const aClosed = closed(a.ws);
    const bClosed = closed(b.ws);
    a.ws.close();
    b.ws.close(1000, 'bye');
    // The room answers each close frame, so both clients finish the handshake.
    await Promise.all([aClosed, bClosed]);
    expect((await publish('107', delta(2))).status).toBe(204);
    const c = await openSocket('107');
    await until(() => c.got.length === 2);
  });

  it('answers at most one resync per socket every 5 s', async () => {
    await publish('108', keyframe(1));
    const { ws, got } = await openSocket('108');
    await until(() => got.length === 1);
    ws.send('resync');
    ws.send('resync');
    await until(() => got.length === 2);
    await new Promise((r) => setTimeout(r, 200));
    expect(got.length).toBe(2);
  });

  it('rejects a delta whose base is not the latest message', async () => {
    await publish('109', keyframe(1));
    await publish('109', delta(2));
    expect((await publish('109', { kind: 'delta', seq: 4, base_seq: 3, patch: {} })).status).toBe(409);
    expect((await publish('109', { kind: 'delta', seq: 2, base_seq: 2, patch: {} })).status).toBe(409);
    expect((await publish('109', { kind: 'delta', seq: 1, base_seq: 0, patch: {} })).status).toBe(409);
    expect((await publish('110', delta(1))).status).toBe(409);
    const { got } = await openSocket('109');
    await until(() => got.length === 2);
    expect(got.map((m) => [m.kind, m.seq])).toEqual([['keyframe', 1], ['delta', 2]]);
  });

  it('rejects a late keyframe (lower seq, older fetch) and leaves the stream alone', async () => {
    const t = Date.now();
    await publish('111', keyframe(10, t));
    await publish('111', delta(11));
    expect((await publish('111', keyframe(9, t - 5_000))).status).toBe(409);
    expect((await publish('111', keyframe(11, t))).status).toBe(409);
    const { got } = await openSocket('111');
    await until(() => got.length === 2);
    expect(got.map((m) => [m.kind, m.seq])).toEqual([['keyframe', 10], ['delta', 11]]);
  });

  it('does not push the idle alarm back on every publish', async () => {
    const stub = env.GAME_ROOM.getByName('112');
    await publish('112', keyframe(1));
    const first = await runInDurableObject(stub, (_room: GameRoom, state) => state.storage.getAlarm());
    expect(first).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    await publish('112', delta(2));
    const second = await runInDurableObject(stub, (_room: GameRoom, state) => state.storage.getAlarm());
    expect(second).toBe(first);
  });

  it('clears its messages when the idle alarm fires', async () => {
    const stub = env.GAME_ROOM.getByName('105');
    await publish('105', keyframe(1));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, (room: GameRoom) => {
      expect(room.replay()).toEqual([]);
    });
  });
});
