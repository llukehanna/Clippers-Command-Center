import { env } from 'cloudflare:workers';
import { createExecutionContext, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker, { gameKey, isAllowedOrigin, type GameRoom } from '../src/index';

const AUTH = { Authorization: 'Bearer test-secret' };
const call = (req: Request) => worker.fetch(req, env, createExecutionContext());
const publish = (game: string, msg: unknown, headers: Record<string, string> = AUTH) =>
  call(new Request(`https://hub/publish/${game}`, { method: 'POST', headers, body: JSON.stringify(msg) }));
const keyframe = (seq: number) => ({ kind: 'keyframe', seq, doc: { seq, fetched_at: new Date().toISOString() } });
const delta = (seq: number) => ({ kind: 'delta', seq, base_seq: seq - 1, patch: {} });

async function openSocket(game: string, origin = 'http://localhost:3000') {
  const res = await call(new Request(`https://hub/ws/${game}`, { headers: { Upgrade: 'websocket', Origin: origin } }));
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
    await publish('104', keyframe(50));
    await publish('104', delta(51));
    await publish('104', keyframe(3));
    const { got } = await openSocket('104');
    await until(() => got.length === 1);
    expect(got.map((m) => m.seq)).toEqual([3]);
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
