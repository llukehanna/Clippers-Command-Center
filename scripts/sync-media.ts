// scripts/sync-media.ts
// News + social → media_items, every 15 minutes (.github/workflows/sync-media.yml).
// Sources: RSS feeds (lib/media/rss.ts FEEDS), r/LAClippers hot — the public
// RSS feed by default (no credentials needed; Reddit now gates the OAuth API
// behind its Responsible Builder Policy approval), or the OAuth JSON API
// (adds real score/comment counts) when REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET
// are set — and Bluesky authenticated search (needs BSKY_HANDLE /
// BSKY_APP_PASSWORD; skipped when unset). One failing source doesn't fail
// the run; all sources failing does. --dry-run fetches and reports without
// writing.
//
// Run via: npm run sync-media [-- --dry-run]
import { sql } from './lib/db.js';
import { FEEDS, parseFeed } from './lib/media/rss.js';
import { fetchRedditHot, fetchRedditRss, redditToItems, redditRssToItems } from './lib/media/reddit.js';
import { blueskyToItems, fetchBlueskyTop } from './lib/media/bluesky.js';
import { dedupeItems, inRetention, MEDIA_RETENTION_DAYS } from './lib/media/normalize.js';
import { clearFeedRanks, pruneMedia, upsertMediaItems } from './lib/media/store.js';
import type { MediaItemInput } from './lib/media/types.js';

const USER_AGENT = 'ClippersCommandCenter/1.0 (+https://clippers.lukeghanna.com)';
const REDDIT_DEFAULT_USER_AGENT = 'web:clippers-command-center:1.0 (by /u/Comfortable-Gift1443)';
const REDDIT_SOURCE = 'r/LAClippers';
const log = (msg: string) => console.log(`[sync-media] ${msg}`);

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const collected: MediaItemInput[] = [];
  let okSources = 0;
  const attempt = async (name: string, fn: () => Promise<MediaItemInput[]>): Promise<boolean> => {
    try {
      const items = await fn();
      okSources++;
      collected.push(...items);
      log(`${name}: ${items.length} item(s)`);
      return true;
    } catch (err) {
      log(`${name}: FAILED (${(err as Error).message})`);
      return false;
    }
  };

  for (const feed of FEEDS) await attempt(feed.source, async () => parseFeed(await fetchText(feed.url), feed));

  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT } = process.env;
  let redditOk: boolean;
  if (REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET) {
    redditOk = await attempt(REDDIT_SOURCE, async () =>
      redditToItems(await fetchRedditHot({ clientId: REDDIT_CLIENT_ID, clientSecret: REDDIT_CLIENT_SECRET, userAgent: REDDIT_USER_AGENT || USER_AGENT })));
  } else {
    redditOk = await attempt(`${REDDIT_SOURCE} (rss)`, async () =>
      redditRssToItems(await fetchRedditRss(REDDIT_USER_AGENT || REDDIT_DEFAULT_USER_AGENT)));
  }

  const { BSKY_HANDLE, BSKY_APP_PASSWORD } = process.env;
  if (BSKY_HANDLE && BSKY_APP_PASSWORD) {
    await attempt('Bluesky', async () =>
      blueskyToItems(await fetchBlueskyTop({ handle: BSKY_HANDLE, appPassword: BSKY_APP_PASSWORD })));
  } else {
    log('Bluesky: skipped (BSKY_HANDLE / BSKY_APP_PASSWORD not set)');
  }

  // Drop stories older than the retention window (pruneMedia would delete
  // them right after) and clamp future timestamps to now, then de-duplicate.
  const kept = inRetention(collected, new Date());
  if (kept.length < collected.length) log(`dropped ${collected.length - kept.length} item(s) older than ${MEDIA_RETENTION_DAYS} days`);
  const items = dedupeItems(kept);
  log(`${items.length} unique item(s) from ${okSources} source(s)`);
  if (okSources === 0) throw new Error('every source failed');

  if (dryRun) {
    for (const i of items.slice(0, 15)) log(`  [${i.kind}] ${i.source}: ${i.title}`);
  } else {
    // A post that fell out of the hot list this run shouldn't keep last
    // run's rank, so clear before upserting this run's ranks.
    if (redditOk) await clearFeedRanks(REDDIT_SOURCE);
    const written = await upsertMediaItems(items);
    const pruned = await pruneMedia();
    log(`upserted ${written}, pruned ${pruned}`);
  }
  await sql.end();
}

main().catch(async (err) => {
  console.error('[sync-media] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
