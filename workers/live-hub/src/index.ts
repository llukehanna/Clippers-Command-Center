// workers/live-hub/src/index.ts
// Live v2 push hub (spec §6.1): the game-night runner POSTs live state here;
// fans' browsers hold a WebSocket per game. Routing, auth and origin checks
// live here; each game's state and sockets live in a GameRoom Durable Object.

import { GameRoom, isWebSocketUpgrade } from './game-room';

export { GameRoom };

const MAX_BODY_BYTES = 512 * 1024;
const NBA_PROBE_URL = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const NBA_HEADERS = {
  Accept: 'application/json',
  Referer: 'https://www.nba.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/** "0022600093" and "22600093" name the same room. */
export function gameKey(raw: string): string | null {
  if (!/^\d{1,12}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? String(n) : null;
}

export function isAllowedOrigin(origin: string | null, allowed: string): boolean {
  if (!origin) return false;
  return allowed.split(',').map((s) => s.trim()).filter(Boolean).includes(origin);
}

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const got = request.headers.get('Authorization') ?? '';
  const want = `Bearer ${secret}`;
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

async function probeNba(): Promise<Response> {
  const started = Date.now();
  const res = await fetch(NBA_PROBE_URL, { headers: NBA_HEADERS });
  const bytes = (await res.arrayBuffer()).byteLength;
  return Response.json({ status: res.status, bytes, ms: Date.now() - started });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const [, route, id] = url.pathname.split('/');

    if (url.pathname === '/health') return new Response('ok');

    if (route === 'probe' && id === 'nba' && request.method === 'GET') {
      if (!authorized(request, env.LIVE_HUB_SECRET)) return new Response('unauthorized', { status: 401 });
      return probeNba();
    }

    if (route === 'publish' && request.method === 'POST') {
      if (!authorized(request, env.LIVE_HUB_SECRET)) return new Response('unauthorized', { status: 401 });
      const key = id ? gameKey(id) : null;
      if (!key) return new Response('bad game id', { status: 400 });
      const body = await request.text();
      if (body.length > MAX_BODY_BYTES) return new Response('too large', { status: 413 });
      return env.GAME_ROOM.getByName(key).fetch(new Request('https://room/publish', { method: 'POST', body }));
    }

    if (route === 'ws' && request.method === 'GET') {
      if (!isWebSocketUpgrade(request)) return new Response('expected websocket', { status: 426 });
      if (!isAllowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
        return new Response('forbidden origin', { status: 403 });
      }
      const key = id ? gameKey(id) : null;
      if (!key) return new Response('bad game id', { status: 400 });
      return env.GAME_ROOM.getByName(key).fetch(request);
    }

    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
