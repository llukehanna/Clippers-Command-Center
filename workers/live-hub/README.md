# Live Hub

The Live Hub is the central push server for Live v2 (see [spec §6.1](../../Docs/superpowers/specs/2026-09-27-live-v2-realtime-design.md#61-the-hub-cloudflare-durable-object)). The game-night runner POSTs live state updates here, and fans' browsers connect via WebSocket to receive real-time game updates. Each game maintains its own isolated message stream with a 150-second replay window for reconnecting clients.

## Endpoints

The hub exposes the following HTTP/WebSocket endpoints:

### `GET /health`
Health check. Returns `200 ok`.

### `POST /publish/:gameId`
Publish a live state message to game `:gameId`. Requires `Authorization: Bearer $LIVE_HUB_SECRET` header.

**Request body:** JSON keyframe or delta object. A keyframe must have integer `seq`, valid `doc.fetched_at` (ISO 8601 timestamp parseable by `Date.parse()`). A delta must have integer `seq` and `base_seq`.

**Responses:**
- `204 No Content` — message accepted
- `400 Bad Request` — malformed JSON, non-object body, missing `seq`, invalid `doc.fetched_at`, or invalid game ID
- `401 Unauthorized` — missing or incorrect secret
- `409 Conflict` — delta whose `base_seq` is not the latest stored seq, or whose `seq` is not strictly greater; or keyframe whose `seq` is ≤ the latest stored seq and whose `doc.fetched_at` is not newer than the newest stored keyframe's
- `413 Payload Too Large` — body exceeds 512 KB

### `GET /ws/:gameId`
Upgrade to WebSocket for game `:gameId`. Requires an `Origin` header matching `ALLOWED_ORIGINS`.

**Responses:**
- `101 Switching Protocols` — WebSocket established; client receives the replay history and all new messages
- `400 Bad Request` — invalid game ID
- `403 Forbidden` — origin not allowed
- `426 Upgrade Required` — not a WebSocket upgrade request

**Client protocol:**
- Send `'ping'` to receive auto `'pong'`
- Send `'resync'` (at most once per 5 seconds per socket) to re-receive the entire replay history

### `GET /probe/nba`
Probe NBA CDN reachability. Requires `Authorization: Bearer $LIVE_HUB_SECRET` header.

**Response:** JSON object with `status` (HTTP status from NBA CDN), `bytes` (response size), and `ms` (round-trip time).

## Runbook

### Initial Setup

**1. Deploy for the first time:**
```bash
cd workers/live-hub
npx wrangler login
npx wrangler deploy
```

**2. Set the secret:**

Generate it once and use the same value in all three places:

```bash
SECRET=$(openssl rand -hex 32)
echo "$SECRET" | npx wrangler secret put LIVE_HUB_SECRET   # the Worker
echo "$SECRET"                                             # copy for the next two
```

- **GitHub Actions:** repo secret `LIVE_HUB_SECRET` (the game-night runner publishes with it).
- **Vercel:** env var `LIVE_HUB_SECRET` (manual `/api/cron/poll-live` ticks publish with it).

### Health & Monitoring

**Check hub health:**
```bash
curl https://live.lukeghanna.com/health
```

**Probe NBA CDN reachability:**
```bash
curl -H "Authorization: Bearer $LIVE_HUB_SECRET" https://live.lukeghanna.com/probe/nba
```

**View real-time logs:**
```bash
npx wrangler tail
```

### Testing

**Publish a test keyframe to game 1:**
```bash
curl -X POST \
  -H "Authorization: Bearer $LIVE_HUB_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"kind":"keyframe","seq":1,"doc":{"seq":1,"fetched_at":"2026-10-01T00:00:00Z"}}' \
  https://live.lukeghanna.com/publish/1
```

**Connect a WebSocket in the browser console** (from https://clippers.lukeghanna.com):
```javascript
const ws = new WebSocket('wss://live.lukeghanna.com/ws/1');
ws.onmessage = (e) => console.log(e.data);
```
