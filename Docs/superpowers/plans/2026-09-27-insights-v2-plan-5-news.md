# Insights v2 — Plan 5: News & Social Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free, auto-refreshing News page (article links + the hottest Clippers social posts) and a "Buzz" module on Home.

**Architecture:** A 15-minute GitHub Actions job (`sync-media`) pulls RSS feeds, r/LAClippers "hot" (free Reddit script app) and Bluesky public search; parsers turn each into one `MediaItemInput` shape; items are de-duplicated and upserted into `media_items` and pruned after 7 days. A loader ranks articles by recency and social posts by engagement with time decay; `/news` and the Home Buzz module render them. Reddit posts that link to X are rendered as real tweets through X's free embed widget, lazy-loaded, with a text fallback.

**Tech Stack:** TypeScript, postgres.js, `fast-xml-parser` (new), Next.js App Router server components, Tailwind v4 tokens already in `app/globals.css`, Vitest, GitHub Actions.

**Spec:** `Docs/superpowers/specs/2026-09-27-insights-engine-design.md` (§1.4 News and social ingest, §3.1 placement, §3.3 News page). Plan 5 of 6; independent of Plans 2–4 and 6.

## Global Constraints

- **Zero recurring cost.** No paid APIs. X content only through the free embed widget (`platform.twitter.com/widgets.js`), never the X API.
- External content never carries a "Verified" badge or insight styling. The News page and Buzz module are labelled **"From around the web"**.
- Articles open in a new tab with `rel="noopener noreferrer"`. Thumbnails use `<img loading="lazy" referrerPolicy="no-referrer">` (no Next image proxy for arbitrary hosts).
- Retention: items older than 7 days are deleted on every sync.
- Social ranking: `engagement / (hours_since_published + 2) ^ 1.5`. Articles: newest first.
- Git paths use `Docs/` (capital D). Script imports use `.js` suffixes. Pure modules never import `scripts/lib/db.ts` or `src/lib/db.ts`.
- `media_items` extends the spec's DDL with `priority SMALLINT` (1 = direct source, 2 = Google News) so a direct outlet's copy of a story wins de-duplication.
- Integration tests: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture` (see Plan 1 for the Docker one-liner).
- Production writes (migration, secrets) need Luke's explicit go-ahead in chat.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `insights/espn-engine`.

## File Structure

| File | Responsibility |
|---|---|
| `Docs/DB_SCHEMA.sql` (modify), `Docs/migrations/2026-10-media.sql` (create) | `media_items` table |
| `scripts/lib/media/types.ts` | `MediaKind`, `MediaItemInput` |
| `scripts/lib/media/normalize.ts` | `titleKey`, `dedupeItems` (pure) |
| `scripts/lib/media/rss.ts` | `FEEDS`, `parseFeed` for RSS 2.0 + Atom (pure) |
| `scripts/lib/media/reddit.ts` | `redditToItems` (pure) + `fetchRedditHot` |
| `scripts/lib/media/bluesky.ts` | `blueskyToItems` (pure) + `fetchBlueskyTop` |
| `scripts/lib/media/store.ts` | `upsertMediaItems`, `pruneMedia` (DB) |
| `scripts/sync-media.ts` | CLI: fetch all sources → dedupe → store (or `--dry-run`) |
| `.github/workflows/sync-media.yml` | 15-minute cron |
| `src/lib/media/shape.ts` | `socialScore`, `shapeMedia` (pure, shared) |
| `src/lib/data/media.ts`, `app/api/media/route.ts` | Loader + route |
| `src/lib/ui/api.ts`, `src/lib/ui/types.ts` (modify) | Register loader; `MediaItem`, `MediaPayload` |
| `components/news/ArticleCard.tsx`, `SocialCard.tsx`, `TweetEmbed.tsx` | Presentation |
| `app/news/page.tsx` | News page |
| `components/home/BuzzPanel.tsx`, `app/home/page.tsx` (modify) | Home Buzz module |
| `components/shell/NavLinks.tsx`, `components/shell/CommandPalette.tsx` (modify) | Navigation |

---

### Task 1: `media_items` table

**Files:**
- Modify: `Docs/DB_SCHEMA.sql` (before the final `COMMIT;`)
- Create: `Docs/migrations/2026-10-media.sql`
- Test: `scripts/lib/pipeline.integration.test.ts`

**Interfaces:**
- Produces table `media_items` with columns `media_id, kind, source, url, dedup_key (UNIQUE), title, author, published_at, engagement, comments, thumbnail_url, embed_url, priority, fetched_at`.

- [ ] **Step 1: Write the failing test**

Add inside the `describe.skipIf(!url)(...)` block of `scripts/lib/pipeline.integration.test.ts`:

```ts
  it('schema has media_items', async () => {
    const [row] = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.media_items') IS NOT NULL AS ok`;
    expect(row.ok).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts -t "media_items"`
Expected: FAIL (`ok` is false).

- [ ] **Step 3: Add the DDL**

Insert before the final `COMMIT;` of `Docs/DB_SCHEMA.sql`:

```sql
-- =============================================================================
-- News and social (scripts/sync-media.ts) — external content, not insights
-- =============================================================================

CREATE TABLE IF NOT EXISTS media_items (
  media_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL,             -- 'article' | 'reddit' | 'tweet' | 'bluesky'
  source        TEXT NOT NULL,             -- 'ESPN', 'LA Times', 'r/LAClippers', 'Bluesky', ...
  url           TEXT NOT NULL,
  dedup_key     TEXT NOT NULL UNIQUE,      -- 'article:<title key>' | 'reddit:<id>' | 'tweet:<id>' | 'bsky:<uri>'
  title         TEXT NOT NULL,
  author        TEXT,
  published_at  TIMESTAMPTZ NOT NULL,
  engagement    INTEGER,                   -- reddit score / bluesky likes + reposts
  comments      INTEGER,
  thumbnail_url TEXT,
  embed_url     TEXT,                      -- tweet URL for kind 'tweet'
  priority      SMALLINT NOT NULL DEFAULT 1, -- lower wins de-duplication (1 direct, 2 aggregator)
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_kind_published ON media_items (kind, published_at DESC);
```

Create `Docs/migrations/2026-10-media.sql`:

```sql
-- Docs/migrations/2026-10-media.sql
-- Insights v2, plan 5: news and social items. Idempotent; one transaction.
BEGIN;
```

followed by the exact block from Step 3 (from `CREATE TABLE IF NOT EXISTS media_items` through the index), then `COMMIT;`.

- [ ] **Step 4: Run test to verify it passes, then commit**

Run the Step 2 command. Expected: PASS.

```bash
git add Docs/DB_SCHEMA.sql Docs/migrations/2026-10-media.sql scripts/lib/pipeline.integration.test.ts
git commit -m "feat(db): media_items for news and social

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared item types, de-duplication and RSS parsing

**Files:**
- Create: `scripts/lib/media/types.ts`, `scripts/lib/media/normalize.ts`, `scripts/lib/media/normalize.test.ts`
- Create: `scripts/lib/media/rss.ts`, `scripts/lib/media/rss.test.ts`
- Modify: `package.json` (dependency)

**Interfaces:**
- Produces (types.ts): `MediaKind`, `MediaItemInput` (below).
- Produces (normalize.ts): `titleKey(title: string): string`, `dedupeItems(items: MediaItemInput[]): MediaItemInput[]`.
- Produces (rss.ts): `FeedConfig`, `FEEDS: FeedConfig[]`, `parseFeed(xml: string, feed: FeedConfig): MediaItemInput[]`.

- [ ] **Step 1: Install the XML parser**

Run: `npm install fast-xml-parser@^5`
Expected: `package.json` gains `"fast-xml-parser"` under `dependencies`.

- [ ] **Step 2: Create the types**

Create `scripts/lib/media/types.ts`:

```ts
// scripts/lib/media/types.ts
// One shape for every news/social source, as written to media_items.

export type MediaKind = 'article' | 'reddit' | 'tweet' | 'bluesky';

export interface MediaItemInput {
  kind: MediaKind;
  source: string;
  url: string;
  dedupKey: string;
  title: string;
  author: string | null;
  publishedAt: string;          // ISO 8601
  engagement: number | null;
  comments: number | null;
  thumbnailUrl: string | null;
  embedUrl: string | null;
  priority: number;             // lower wins de-duplication
}
```

- [ ] **Step 3: Write the failing tests**

Create `scripts/lib/media/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dedupeItems, titleKey } from './normalize';
import type { MediaItemInput } from './types';

const item = (p: Partial<MediaItemInput>): MediaItemInput => ({
  kind: 'article', source: 'ESPN', url: 'https://x', dedupKey: 'k', title: 't', author: null,
  publishedAt: '2026-10-20T12:00:00Z', engagement: null, comments: null, thumbnailUrl: null, embedUrl: null, priority: 1, ...p,
});

describe('titleKey', () => {
  it('ignores case, punctuation and accents', () => {
    expect(titleKey("Clippers' Harden: 'We'll be fine' — after loss")).toBe('clippers harden we ll be fine after loss');
    expect(titleKey('Jokić scores 40')).toBe(titleKey('Jokic Scores 40!'));
  });
});

describe('dedupeItems', () => {
  it('keeps one item per key, preferring the lower priority number', () => {
    const out = dedupeItems([
      item({ dedupKey: 'a', source: 'Google News', priority: 2 }),
      item({ dedupKey: 'a', source: 'LA Times', priority: 1 }),
      item({ dedupKey: 'b', source: 'ESPN' }),
    ]);
    expect(out.map((i) => [i.dedupKey, i.source])).toEqual([['a', 'LA Times'], ['b', 'ESPN']]);
  });
  it('keeps the first seen on equal priority', () => {
    const out = dedupeItems([item({ dedupKey: 'a', source: 'ESPN' }), item({ dedupKey: 'a', source: 'LA Times' })]);
    expect(out[0].source).toBe('ESPN');
  });
});
```

Create `scripts/lib/media/rss.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFeed, type FeedConfig } from './rss';

const espn: FeedConfig = { source: 'ESPN', url: 'https://example/espn', requireMention: true, splitPublisher: false, priority: 1 };
const google: FeedConfig = { source: 'Google News', url: 'https://example/g', requireMention: false, splitPublisher: true, priority: 2 };
const clipsNation: FeedConfig = { source: 'Clips Nation', url: 'https://example/cn', requireMention: false, splitPublisher: false, priority: 1 };

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <item>
    <title><![CDATA[Clippers beat Nuggets behind Leonard's 41]]></title>
    <link>https://www.espn.com/nba/story/_/id/1</link>
    <pubDate>Mon, 20 Oct 2026 04:12:00 GMT</pubDate>
    <description><![CDATA[<p>Kawhi Leonard scored 41.</p>]]></description>
    <dc:creator>Ohm Youngmisuk</dc:creator>
    <media:content url="https://a.espncdn.com/photo/1.jpg" medium="image"/>
  </item>
  <item>
    <title>Celtics top Knicks</title>
    <link>https://www.espn.com/nba/story/_/id/2</link>
    <pubDate>Mon, 20 Oct 2026 03:00:00 GMT</pubDate>
    <description>Boston rolls.</description>
  </item>
  <item>
    <title>Undated Clippers note</title>
    <link>https://www.espn.com/nba/story/_/id/3</link>
  </item>
</channel>
</rss>`;

const GOOGLE = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Clippers' defense shines in opener - Los Angeles Times</title>
    <link>https://news.google.com/rss/articles/abc</link>
    <pubDate>Mon, 20 Oct 2026 05:00:00 GMT</pubDate>
    <source url="https://www.latimes.com">Los Angeles Times</source>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Clippers vs. Nuggets: Instant reaction</title>
    <link rel="alternate" type="text/html" href="https://www.clipsnation.com/2026/10/20/reaction"/>
    <published>2026-10-20T06:00:00-07:00</published>
    <author><name>Robert Flom</name></author>
    <content type="html">&lt;p&gt;Quick thoughts&lt;/p&gt;</content>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('parses RSS 2.0, keeps Clippers stories, skips undated items', () => {
    const items = parseFeed(RSS, espn);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'article', source: 'ESPN', title: "Clippers beat Nuggets behind Leonard's 41",
      url: 'https://www.espn.com/nba/story/_/id/1', author: 'Ohm Youngmisuk',
      publishedAt: '2026-10-20T04:12:00.000Z', thumbnailUrl: 'https://a.espncdn.com/photo/1.jpg',
      dedupKey: 'article:clippers beat nuggets behind leonard s 41', priority: 1,
    });
  });
  it('splits the publisher out of Google News titles', () => {
    const [item] = parseFeed(GOOGLE, google);
    expect(item).toMatchObject({ source: 'Los Angeles Times', title: "Clippers' defense shines in opener", priority: 2 });
    expect(item.dedupKey).toBe('article:clippers defense shines in opener');
  });
  it('parses Atom feeds', () => {
    const [item] = parseFeed(ATOM, clipsNation);
    expect(item).toMatchObject({
      source: 'Clips Nation', url: 'https://www.clipsnation.com/2026/10/20/reaction', author: 'Robert Flom',
      publishedAt: '2026-10-20T13:00:00.000Z',
    });
  });
  it('returns nothing for malformed XML', () => {
    expect(parseFeed('<not-a-feed>', espn)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run scripts/lib/media`
Expected: FAIL — modules do not exist.

- [ ] **Step 5: Implement `normalize.ts`**

Create `scripts/lib/media/normalize.ts`:

```ts
// scripts/lib/media/normalize.ts
// De-duplication helpers. Pure.
import type { MediaItemInput } from './types.js';

/** Comparable form of a headline: lowercase ASCII words. */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** One item per dedupKey; the lowest priority number wins, then the first seen. Keeps input order. */
export function dedupeItems(items: MediaItemInput[]): MediaItemInput[] {
  const best = new Map<string, MediaItemInput>();
  for (const it of items) {
    const cur = best.get(it.dedupKey);
    if (!cur || it.priority < cur.priority) best.set(it.dedupKey, it);
  }
  const order: string[] = [];
  for (const it of items) if (!order.includes(it.dedupKey)) order.push(it.dedupKey);
  return order.map((k) => best.get(k)!);
}
```

- [ ] **Step 6: Implement `rss.ts`**

Create `scripts/lib/media/rss.ts`:

```ts
// scripts/lib/media/rss.ts
// RSS 2.0 and Atom → MediaItemInput. Pure; fetching happens in sync-media.
import { XMLParser } from 'fast-xml-parser';
import { titleKey } from './normalize.js';
import type { MediaItemInput } from './types.js';

export interface FeedConfig {
  source: string;
  url: string;
  /** General-NBA feeds: keep only items that mention the Clippers. */
  requireMention: boolean;
  /** Google News: title is "Headline - Publisher"; use the publisher as the source. */
  splitPublisher: boolean;
  priority: number;
}

export const FEEDS: FeedConfig[] = [
  { source: 'ESPN', url: 'https://www.espn.com/espn/rss/nba/news', requireMention: true, splitPublisher: false, priority: 1 },
  { source: 'LA Times', url: 'https://www.latimes.com/sports/clippers/rss2.0.xml', requireMention: false, splitPublisher: false, priority: 1 },
  { source: 'Clips Nation', url: 'https://www.clipsnation.com/rss/index.xml', requireMention: false, splitPublisher: false, priority: 1 },
  { source: 'NBA.com', url: 'https://www.nba.com/clippers/rss.xml', requireMention: false, splitPublisher: false, priority: 1 },
  {
    source: 'Google News',
    url: 'https://news.google.com/rss/search?q=%22LA+Clippers%22&hl=en-US&gl=US&ceid=US:en',
    requireMention: false, splitPublisher: true, priority: 2,
  },
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', htmlEntities: true });
const MENTION = /\bclippers\b/i;

type Node = Record<string, unknown>;
const list = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return text((v as Node)['#text']);
  return String(v).trim();
}
const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const attr = (v: unknown, name: string): string | null => {
  const n = list(v as Node | Node[])[0];
  const a = n?.[`@_${name}`];
  return typeof a === 'string' && a ? a : null;
};

interface RawEntry { title: string; link: string; date: string; description: string; author: string | null; thumb: string | null; publisher: string | null }

function rssEntries(channel: Node | undefined): RawEntry[] {
  return list(channel?.item as Node | Node[]).map((i) => ({
    title: text(i.title),
    link: text(i.link),
    date: text(i.pubDate) || text(i['dc:date']),
    description: stripHtml(text(i.description)),
    author: text(i['dc:creator']) || text(i.author) || null,
    thumb:
      attr(i['media:content'], 'url') ??
      attr(i['media:thumbnail'], 'url') ??
      ((attr(i.enclosure, 'type') ?? '').startsWith('image') ? attr(i.enclosure, 'url') : null),
    publisher: text(i.source) || null,
  }));
}

function atomEntries(feed: Node | undefined): RawEntry[] {
  return list(feed?.entry as Node | Node[]).map((e) => {
    const links = list(e.link as Node | Node[]);
    const alt = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? links[0];
    return {
      title: text(e.title),
      link: typeof alt?.['@_href'] === 'string' ? (alt['@_href'] as string) : '',
      date: text(e.published) || text(e.updated),
      description: stripHtml(text(e.summary) || text(e.content)),
      author: text((e.author as Node | undefined)?.name) || null,
      thumb: null,
      publisher: null,
    };
  });
}

export function parseFeed(xml: string, feed: FeedConfig): MediaItemInput[] {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch {
    return [];
  }
  const entries = [...rssEntries((doc.rss as Node | undefined)?.channel as Node | undefined), ...atomEntries(doc.feed as Node | undefined)];

  const items: MediaItemInput[] = [];
  for (const e of entries) {
    const published = new Date(e.date);
    if (!e.title || !/^https?:\/\//.test(e.link) || Number.isNaN(published.getTime())) continue;
    if (feed.requireMention && !MENTION.test(`${e.title} ${e.description}`)) continue;

    let title = e.title;
    let source = feed.source;
    if (feed.splitPublisher && e.publisher) {
      source = e.publisher;
      const suffix = ` - ${e.publisher}`;
      if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
    }
    items.push({
      kind: 'article', source, url: e.link, dedupKey: `article:${titleKey(title)}`, title,
      author: e.author, publishedAt: published.toISOString(), engagement: null, comments: null,
      thumbnailUrl: e.thumb, embedUrl: null, priority: feed.priority,
    });
  }
  return items;
}
```

- [ ] **Step 7: Run tests to verify they pass, then commit**

Run: `npx vitest run scripts/lib/media`
Expected: PASS.

```bash
git add package.json package-lock.json scripts/lib/media/types.ts scripts/lib/media/normalize.ts scripts/lib/media/normalize.test.ts scripts/lib/media/rss.ts scripts/lib/media/rss.test.ts
git commit -m "feat(media): RSS/Atom parsing and headline de-duplication

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reddit and Bluesky sources

**Files:**
- Create: `scripts/lib/media/reddit.ts`, `scripts/lib/media/reddit.test.ts`
- Create: `scripts/lib/media/bluesky.ts`, `scripts/lib/media/bluesky.test.ts`

**Interfaces:**
- Produces (reddit.ts): `RedditCredentials = { clientId: string; clientSecret: string; userAgent: string }`, `redditToItems(listing: unknown): MediaItemInput[]`, `fetchRedditHot(creds: RedditCredentials): Promise<unknown>`, `tweetUrl(url: string): { id: string; embedUrl: string } | null`.
- Produces (bluesky.ts): `blueskyToItems(resp: unknown): MediaItemInput[]`, `fetchBlueskyTop(now?: Date): Promise<unknown>`, `BSKY_MIN_LIKES = 10`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/media/reddit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { redditToItems, tweetUrl } from './reddit';

const post = (data: Record<string, unknown>) => ({ kind: 't3', data: {
  id: 'abc', title: 'Kawhi drops 41', permalink: '/r/LAClippers/comments/abc/kawhi_drops_41/', url: 'https://www.reddit.com/r/LAClippers/comments/abc/',
  author: 'fan1', score: 812, num_comments: 140, created_utc: 1792468800, stickied: false, over_18: false, link_flair_text: null,
  thumbnail: 'self', ...data } });

describe('tweetUrl', () => {
  it('recognizes x.com and twitter.com status links', () => {
    expect(tweetUrl('https://x.com/ShamsCharania/status/1847000000000000000?s=46')).toEqual({ id: '1847000000000000000', embedUrl: 'https://twitter.com/ShamsCharania/status/1847000000000000000' });
    expect(tweetUrl('https://mobile.twitter.com/LAClippers/status/123')).toEqual({ id: '123', embedUrl: 'https://twitter.com/LAClippers/status/123' });
    expect(tweetUrl('https://www.espn.com/nba/story')).toBeNull();
  });
});

describe('redditToItems', () => {
  it('maps hot posts and turns tweet links into tweet items', () => {
    const items = redditToItems({ data: { children: [
      post({}),
      post({ id: 'def', title: '[Shams] Clippers sign ...', url: 'https://x.com/ShamsCharania/status/999', score: 2400,
             preview: { images: [{ source: { url: 'https://preview.redd.it/p.jpg' } }] } }),
    ] } });
    expect(items[0]).toMatchObject({
      kind: 'reddit', source: 'r/LAClippers', dedupKey: 'reddit:abc', title: 'Kawhi drops 41', author: 'fan1',
      url: 'https://www.reddit.com/r/LAClippers/comments/abc/kawhi_drops_41/', engagement: 812, comments: 140,
      publishedAt: new Date(1792468800 * 1000).toISOString(), embedUrl: null, thumbnailUrl: null,
    });
    expect(items[1]).toMatchObject({ kind: 'tweet', dedupKey: 'tweet:999', embedUrl: 'https://twitter.com/ShamsCharania/status/999', thumbnailUrl: 'https://preview.redd.it/p.jpg' });
  });
  it('drops stickied, NSFW and game-thread posts', () => {
    const items = redditToItems({ data: { children: [
      post({ id: '1', stickied: true }),
      post({ id: '2', over_18: true }),
      post({ id: '3', title: 'GAME THREAD: Clippers vs Nuggets' }),
      post({ id: '4', link_flair_text: 'Post Game Thread' }),
      post({ id: '5' }),
    ] } });
    expect(items.map((i) => i.dedupKey)).toEqual(['reddit:5']);
  });
  it('returns nothing for an unexpected payload', () => {
    expect(redditToItems({ error: 403 })).toEqual([]);
  });
});
```

Create `scripts/lib/media/bluesky.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { blueskyToItems } from './bluesky';

const p = (over: Record<string, unknown>) => ({
  uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz',
  author: { handle: 'lawmurray.bsky.social', displayName: 'Law Murray' },
  record: { text: 'Clippers starting five tonight: ...', createdAt: '2026-10-20T01:00:00.000Z' },
  likeCount: 40, repostCount: 5, replyCount: 3, ...over,
});

describe('blueskyToItems', () => {
  it('maps posts with a web URL and engagement', () => {
    const [item] = blueskyToItems({ posts: [p({})] });
    expect(item).toMatchObject({
      kind: 'bluesky', source: 'Bluesky', author: 'Law Murray', title: 'Clippers starting five tonight: ...',
      url: 'https://bsky.app/profile/lawmurray.bsky.social/post/3kxyz', engagement: 45, comments: 3,
      dedupKey: 'bsky:at://did:plc:abc/app.bsky.feed.post/3kxyz', publishedAt: '2026-10-20T01:00:00.000Z',
    });
  });
  it('drops low-engagement posts and posts that do not mention the Clippers', () => {
    expect(blueskyToItems({ posts: [p({ likeCount: 3 }), p({ record: { text: 'Lakers news', createdAt: '2026-10-20T01:00:00.000Z' } })] })).toEqual([]);
  });
  it('returns nothing for an unexpected payload', () => {
    expect(blueskyToItems({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/lib/media/reddit.test.ts scripts/lib/media/bluesky.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement `reddit.ts`**

Create `scripts/lib/media/reddit.ts`:

```ts
// scripts/lib/media/reddit.ts
// r/LAClippers "hot" via a free Reddit script app (OAuth client credentials).
// Posts that link to an X status become kind 'tweet' so the UI can embed the
// real post; the rest stay 'reddit'.
import type { MediaItemInput } from './types.js';

export interface RedditCredentials { clientId: string; clientSecret: string; userAgent: string }

const SUBREDDIT = 'LAClippers';
const THREAD = /\b(game thread|post[- ]?game thread|pre[- ]?game thread)\b/i;
const TWEET = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/;

export function tweetUrl(url: string): { id: string; embedUrl: string } | null {
  const m = TWEET.exec(url);
  return m ? { id: m[2], embedUrl: `https://twitter.com/${m[1]}/status/${m[2]}` } : null;
}

interface RedditPost {
  id: string; title: string; permalink: string; url: string; author: string; score: number; num_comments: number;
  created_utc: number; stickied: boolean; over_18: boolean; link_flair_text: string | null; thumbnail?: string;
  preview?: { images?: { source?: { url?: string } }[] };
}

export function redditToItems(listing: unknown): MediaItemInput[] {
  const children = (listing as { data?: { children?: { data: RedditPost }[] } })?.data?.children;
  if (!Array.isArray(children)) return [];
  const items: MediaItemInput[] = [];
  for (const { data: p } of children) {
    if (!p || p.stickied || p.over_18) continue;
    if (THREAD.test(p.title) || THREAD.test(p.link_flair_text ?? '')) continue;
    const tweet = tweetUrl(p.url ?? '');
    const preview = p.preview?.images?.[0]?.source?.url ?? null;
    const thumb = preview ?? (p.thumbnail?.startsWith('http') ? p.thumbnail : null);
    items.push({
      kind: tweet ? 'tweet' : 'reddit',
      source: `r/${SUBREDDIT}`,
      url: `https://www.reddit.com${p.permalink}`,
      dedupKey: tweet ? `tweet:${tweet.id}` : `reddit:${p.id}`,
      title: p.title,
      author: p.author ?? null,
      publishedAt: new Date(p.created_utc * 1000).toISOString(),
      engagement: p.score ?? null,
      comments: p.num_comments ?? null,
      thumbnailUrl: thumb,
      embedUrl: tweet?.embedUrl ?? null,
      priority: 1,
    });
  }
  return items;
}

export async function fetchRedditHot(creds: RedditCredentials): Promise<unknown> {
  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'User-Agent': creds.userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) throw new Error(`reddit token HTTP ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error('reddit token missing');
  const res = await fetch(`https://oauth.reddit.com/r/${SUBREDDIT}/hot?limit=50&raw_json=1`, {
    headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': creds.userAgent },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`reddit hot HTTP ${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Implement `bluesky.ts`**

Create `scripts/lib/media/bluesky.ts`:

```ts
// scripts/lib/media/bluesky.ts
// Top Bluesky posts mentioning the Clippers in the last 24 hours (public AppView, no auth).
import type { MediaItemInput } from './types.js';

export const BSKY_MIN_LIKES = 10;
const MENTION = /\bclippers\b/i;

interface BskyPost {
  uri: string;
  author: { handle: string; displayName?: string };
  record: { text?: string; createdAt?: string };
  likeCount?: number; repostCount?: number; replyCount?: number;
}

export function blueskyToItems(resp: unknown): MediaItemInput[] {
  const posts = (resp as { posts?: BskyPost[] })?.posts;
  if (!Array.isArray(posts)) return [];
  const items: MediaItemInput[] = [];
  for (const p of posts) {
    const text = (p.record?.text ?? '').trim();
    const created = new Date(p.record?.createdAt ?? '');
    if (!text || !MENTION.test(text) || Number.isNaN(created.getTime())) continue;
    if ((p.likeCount ?? 0) < BSKY_MIN_LIKES) continue;
    const rkey = p.uri.split('/').pop();
    items.push({
      kind: 'bluesky', source: 'Bluesky',
      url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
      dedupKey: `bsky:${p.uri}`,
      title: text.length > 300 ? `${text.slice(0, 297)}…` : text,
      author: p.author.displayName || p.author.handle,
      publishedAt: created.toISOString(),
      engagement: (p.likeCount ?? 0) + (p.repostCount ?? 0),
      comments: p.replyCount ?? null,
      thumbnailUrl: null, embedUrl: null, priority: 1,
    });
  }
  return items;
}

export async function fetchBlueskyTop(now: Date = new Date()): Promise<unknown> {
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const q = new URLSearchParams({ q: 'clippers', sort: 'top', since, limit: '50' });
  const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?${q}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`bluesky search HTTP ${res.status}`);
  return res.json();
}
```

- [ ] **Step 5: Run tests to verify they pass, then commit**

Run: `npx vitest run scripts/lib/media`
Expected: PASS.

```bash
git add scripts/lib/media/reddit.ts scripts/lib/media/reddit.test.ts scripts/lib/media/bluesky.ts scripts/lib/media/bluesky.test.ts
git commit -m "feat(media): r/LAClippers hot (tweets as embeds) and Bluesky sources

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `sync-media` job (store, prune, workflow)

**Files:**
- Create: `scripts/lib/media/store.ts`, `scripts/sync-media.ts`, `.github/workflows/sync-media.yml`
- Modify: `package.json`
- Test: `scripts/lib/pipeline.integration.test.ts`

**Interfaces:**
- Consumes: `FEEDS`, `parseFeed`, `redditToItems`, `fetchRedditHot`, `blueskyToItems`, `fetchBlueskyTop`, `dedupeItems`.
- Produces: `upsertMediaItems(items: MediaItemInput[], db?: Db): Promise<number>`, `pruneMedia(db?: Db, now?: Date): Promise<number>`, `MEDIA_RETENTION_DAYS = 7`; CLI `npm run sync-media [-- --dry-run]`.

- [ ] **Step 1: Write the failing integration test**

Add to `scripts/lib/pipeline.integration.test.ts`:

```ts
  it('stores media items: priority wins duplicates, engagement refreshes, old items pruned', async () => {
    const { upsertMediaItems, pruneMedia } = await import('./media/store');
    const base = { kind: 'article' as const, author: null, engagement: null, comments: null, thumbnailUrl: null, embedUrl: null };
    const now = new Date();
    await upsertMediaItems([
      { ...base, source: 'Google News', url: 'https://g/1', dedupKey: 'article:clippers win', title: 'Clippers win', publishedAt: now.toISOString(), priority: 2 },
      { ...base, source: 'Old', url: 'https://old', dedupKey: 'article:old', title: 'Old', publishedAt: new Date(now.getTime() - 9 * 86_400_000).toISOString(), priority: 1 },
    ]);
    await upsertMediaItems([
      { ...base, source: 'LA Times', url: 'https://latimes/1', dedupKey: 'article:clippers win', title: 'Clippers win', publishedAt: now.toISOString(), priority: 1 },
      { ...base, kind: 'reddit', source: 'r/LAClippers', url: 'https://reddit/1', dedupKey: 'reddit:1', title: 'Post', publishedAt: now.toISOString(), priority: 1, engagement: 5 },
    ]);
    await upsertMediaItems([
      { ...base, kind: 'reddit', source: 'r/LAClippers', url: 'https://reddit/1', dedupKey: 'reddit:1', title: 'Post', publishedAt: now.toISOString(), priority: 1, engagement: 50 },
      { ...base, source: 'Google News', url: 'https://g/1', dedupKey: 'article:clippers win', title: 'Clippers win', publishedAt: now.toISOString(), priority: 2 },
    ]);
    const rows = await sql<{ dedup_key: string; source: string; engagement: number | null }[]>`
      SELECT dedup_key, source, engagement FROM media_items ORDER BY dedup_key`;
    expect(rows).toEqual([
      { dedup_key: 'article:clippers win', source: 'LA Times', engagement: null },
      { dedup_key: 'article:old', source: 'Old', engagement: null },
      { dedup_key: 'reddit:1', source: 'r/LAClippers', engagement: 50 },
    ]);
    expect(await pruneMedia()).toBe(1);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts -t "media items"`
Expected: FAIL — `./media/store` does not exist.

- [ ] **Step 3: Implement the store**

Create `scripts/lib/media/store.ts`:

```ts
// scripts/lib/media/store.ts
// media_items writes. A lower priority number replaces an existing story's
// source/url/title; engagement and comment counts always refresh.
import { sql as rootSql } from '../db.js';
import type { Db } from '../upserts.js';
import type { MediaItemInput } from './types.js';

export const MEDIA_RETENTION_DAYS = 7;

export async function upsertMediaItems(items: MediaItemInput[], db: Db = rootSql): Promise<number> {
  if (items.length === 0) return 0;
  const rows = items.map((i) => ({
    kind: i.kind, source: i.source, url: i.url, dedup_key: i.dedupKey, title: i.title, author: i.author,
    published_at: i.publishedAt, engagement: i.engagement, comments: i.comments,
    thumbnail_url: i.thumbnailUrl, embed_url: i.embedUrl, priority: i.priority,
  }));
  const result = await db`
    INSERT INTO media_items ${db(rows)}
    ON CONFLICT (dedup_key) DO UPDATE SET
      engagement    = EXCLUDED.engagement,
      comments      = EXCLUDED.comments,
      thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, media_items.thumbnail_url),
      source        = CASE WHEN EXCLUDED.priority < media_items.priority THEN EXCLUDED.source ELSE media_items.source END,
      url           = CASE WHEN EXCLUDED.priority < media_items.priority THEN EXCLUDED.url ELSE media_items.url END,
      title         = CASE WHEN EXCLUDED.priority < media_items.priority THEN EXCLUDED.title ELSE media_items.title END,
      author        = CASE WHEN EXCLUDED.priority < media_items.priority THEN EXCLUDED.author ELSE media_items.author END,
      priority      = LEAST(EXCLUDED.priority, media_items.priority),
      fetched_at    = now()
  `;
  return result.count;
}

export async function pruneMedia(db: Db = rootSql, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MEDIA_RETENTION_DAYS * 86_400_000).toISOString();
  const result = await db`DELETE FROM media_items WHERE published_at < ${cutoff}::timestamptz`;
  return result.count;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Implement the CLI**

Create `scripts/sync-media.ts`:

```ts
// scripts/sync-media.ts
// News + social → media_items, every 15 minutes (.github/workflows/sync-media.yml).
// Sources: RSS feeds (lib/media/rss.ts FEEDS), r/LAClippers hot (needs
// REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET / REDDIT_USER_AGENT; skipped when
// unset), Bluesky public search. One failing source doesn't fail the run;
// all sources failing does. --dry-run fetches and reports without writing.
//
// Run via: npm run sync-media [-- --dry-run]
import { sql } from './lib/db.js';
import { FEEDS, parseFeed } from './lib/media/rss.js';
import { fetchRedditHot, redditToItems } from './lib/media/reddit.js';
import { blueskyToItems, fetchBlueskyTop } from './lib/media/bluesky.js';
import { dedupeItems } from './lib/media/normalize.js';
import { pruneMedia, upsertMediaItems } from './lib/media/store.js';
import type { MediaItemInput } from './lib/media/types.js';

const USER_AGENT = 'ClippersCommandCenter/1.0 (+https://clippers.lukeghanna.com)';
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
  const attempt = async (name: string, fn: () => Promise<MediaItemInput[]>) => {
    try {
      const items = await fn();
      okSources++;
      collected.push(...items);
      log(`${name}: ${items.length} item(s)`);
    } catch (err) {
      log(`${name}: FAILED (${(err as Error).message})`);
    }
  };

  for (const feed of FEEDS) await attempt(feed.source, async () => parseFeed(await fetchText(feed.url), feed));

  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT } = process.env;
  if (REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET) {
    await attempt('r/LAClippers', async () =>
      redditToItems(await fetchRedditHot({ clientId: REDDIT_CLIENT_ID, clientSecret: REDDIT_CLIENT_SECRET, userAgent: REDDIT_USER_AGENT || USER_AGENT })));
  } else {
    log('r/LAClippers: skipped (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set)');
  }
  await attempt('Bluesky', async () => blueskyToItems(await fetchBlueskyTop()));

  const items = dedupeItems(collected);
  log(`${items.length} unique item(s) from ${okSources} source(s)`);
  if (okSources === 0) throw new Error('every source failed');

  if (dryRun) {
    for (const i of items.slice(0, 15)) log(`  [${i.kind}] ${i.source}: ${i.title}`);
  } else {
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
```

Add to `package.json` `scripts`:

```json
    "sync-media": "node --env-file-if-exists=.env.local node_modules/.bin/tsx scripts/sync-media.ts",
```

- [ ] **Step 6: Add the workflow**

Create `.github/workflows/sync-media.yml`:

```yaml
name: Sync Media

on:
  schedule:
    - cron: '*/15 * * * *'   # every 15 minutes (GitHub may delay scheduled runs)
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Fetch and report without writing (true/false)'
        required: false
        default: 'false'

permissions:
  contents: read

concurrency:
  group: sync-media
  cancel-in-progress: true

jobs:
  sync-media:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: '24'
          cache: 'npm'

      - run: npm ci

      - run: npm run sync-media -- ${{ inputs.dry_run == 'true' && '--dry-run' || '' }}
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          REDDIT_CLIENT_ID: ${{ secrets.REDDIT_CLIENT_ID }}
          REDDIT_CLIENT_SECRET: ${{ secrets.REDDIT_CLIENT_SECRET }}
          REDDIT_USER_AGENT: ${{ secrets.REDDIT_USER_AGENT }}
```

- [ ] **Step 7: Local dry run, typecheck, commit**

Run: `npm run sync-media -- --dry-run` (needs real network; run with the sandbox disabled). Expected: one line per source with an item count or `FAILED (...)`, then a sample of titles. Any feed that fails with HTTP 404/403 locally: re-check its URL on the outlet's site; if there is no working feed, delete it from `FEEDS` and its test expectations are unaffected. Then `npx tsc --noEmit && npm run lint`.

```bash
git add scripts/lib/media/store.ts scripts/sync-media.ts .github/workflows/sync-media.yml package.json scripts/lib/pipeline.integration.test.ts scripts/lib/media/rss.ts
git commit -m "feat(media): sync-media job every 15 minutes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Media loader and `/api/media`

**Files:**
- Create: `src/lib/media/shape.ts`, `src/lib/media/shape.test.ts`
- Create: `src/lib/data/media.ts`, `app/api/media/route.ts`
- Modify: `src/lib/ui/types.ts`, `src/lib/ui/api.ts`

**Interfaces:**
- Produces (ui/types.ts): `MediaKind`, `MediaItem`, `MediaPayload = { meta: MetaEnvelope; articles: MediaItem[]; social: MediaItem[] }`.
- Produces (shape.ts): `socialScore(item: Pick<MediaItem, 'engagement' | 'published_at'>, now: Date): number`, `shapeMedia(rows: MediaItem[], now: Date, limit: number): { articles: MediaItem[]; social: MediaItem[] }`.
- Produces: `loadMedia(url: URL): Promise<ApiResult>`; `GET /api/media?kind=article|social&limit=N` (default 30, max 60); `getJson('/api/media?...')`.

- [ ] **Step 1: Add the UI types**

Append to `src/lib/ui/types.ts`:

```ts
export type MediaKind = 'article' | 'reddit' | 'tweet' | 'bluesky'

/** News/social item from /api/media — external content, never "verified". */
export interface MediaItem {
  media_id: string
  kind: MediaKind
  source: string
  url: string
  title: string
  author: string | null
  published_at: string
  engagement: number | null
  comments: number | null
  thumbnail_url: string | null
  embed_url: string | null
}

export interface MediaPayload {
  meta: MetaEnvelope
  articles: MediaItem[]
  social: MediaItem[]
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/media/shape.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shapeMedia, socialScore } from './shape';
import type { MediaItem } from '../ui/types';

const now = new Date('2026-10-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const item = (p: Partial<MediaItem>): MediaItem => ({
  media_id: Math.random().toString(36), kind: 'article', source: 'ESPN', url: 'https://x', title: 't', author: null,
  published_at: hoursAgo(1), engagement: null, comments: null, thumbnail_url: null, embed_url: null, ...p,
});

describe('socialScore', () => {
  it('decays engagement with age', () => {
    expect(socialScore({ engagement: 100, published_at: hoursAgo(0) }, now)).toBeCloseTo(100 / 2 ** 1.5);
    expect(socialScore({ engagement: 100, published_at: hoursAgo(10) }, now)).toBeLessThan(socialScore({ engagement: 100, published_at: hoursAgo(1) }, now));
    expect(socialScore({ engagement: null, published_at: hoursAgo(1) }, now)).toBe(0);
  });
});

describe('shapeMedia', () => {
  it('splits articles (newest first) from social (hottest first) and applies the limit', () => {
    const rows = [
      item({ media_id: 'a-old', published_at: hoursAgo(5) }),
      item({ media_id: 'a-new', published_at: hoursAgo(1) }),
      item({ media_id: 's-fresh', kind: 'tweet', engagement: 300, published_at: hoursAgo(1) }),
      item({ media_id: 's-big-old', kind: 'reddit', engagement: 900, published_at: hoursAgo(30) }),
      item({ media_id: 's-small', kind: 'bluesky', engagement: 20, published_at: hoursAgo(1) }),
    ];
    const out = shapeMedia(rows, now, 2);
    expect(out.articles.map((i) => i.media_id)).toEqual(['a-new', 'a-old']);
    expect(out.social.map((i) => i.media_id)).toEqual(['s-fresh', 's-big-old']);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/media/shape.test.ts`
Expected: FAIL — `./shape` does not exist.

- [ ] **Step 4: Implement `shape.ts`**

Create `src/lib/media/shape.ts`:

```ts
// src/lib/media/shape.ts
// Ranking for /api/media. Pure.
import type { MediaItem } from '../ui/types';

/** Hacker-News-style heat: engagement decayed by age in hours. */
export function socialScore(item: Pick<MediaItem, 'engagement' | 'published_at'>, now: Date): number {
  const hours = Math.max(0, (now.getTime() - new Date(item.published_at).getTime()) / 3_600_000);
  return (item.engagement ?? 0) / (hours + 2) ** 1.5;
}

export function shapeMedia(rows: MediaItem[], now: Date, limit: number): { articles: MediaItem[]; social: MediaItem[] } {
  const articles = rows
    .filter((r) => r.kind === 'article')
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, limit);
  const social = rows
    .filter((r) => r.kind !== 'article')
    .map((r) => ({ r, s: socialScore(r, now) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ r }) => r);
  return { articles, social };
}
```

Run: `npx vitest run src/lib/media/shape.test.ts` — expected: PASS.

- [ ] **Step 5: Implement the loader and route**

Create `src/lib/data/media.ts`:

```ts
// src/lib/data/media.ts
// GET /api/media — news articles and social posts from media_items (last 7 days).
//   ?kind=article|social  (default: both)   ?limit=N (default 30, max 60)
import { json, type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { shapeMedia } from '@/src/lib/media/shape';
import type { MediaItem } from '@/src/lib/ui/types';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;

export async function loadMedia(url: URL): Promise<ApiResult> {
  try {
    const kind = url.searchParams.get('kind');
    if (kind !== null && kind !== 'article' && kind !== 'social') {
      return json(buildError('BAD_REQUEST', 'kind must be article or social'), { status: 400 });
    }
    const raw = parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
    const limit = Math.min(Math.max(Number.isNaN(raw) ? DEFAULT_LIMIT : raw, 1), MAX_LIMIT);

    const rows = await sql<(Omit<MediaItem, 'published_at'> & { published_at: Date })[]>`
      SELECT media_id::text AS media_id, kind, source, url, title, author, published_at,
             engagement, comments, thumbnail_url, embed_url
      FROM media_items
      WHERE published_at > now() - interval '7 days'
        ${kind === 'article' ? sql`AND kind = 'article'` : kind === 'social' ? sql`AND kind <> 'article'` : sql``}
      ORDER BY published_at DESC
      LIMIT 400
    `;
    const items: MediaItem[] = rows.map((r) => ({ ...r, published_at: r.published_at.toISOString() }));
    const { articles, social } = shapeMedia(items, new Date(), limit);
    return json({ meta: buildMeta('db', 300), articles, social }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (err) {
    console.error('[GET /api/media] Unexpected error:', err);
    return json(buildError('INTERNAL_ERROR', 'Failed to fetch media'), { status: 500 });
  }
}
```

Create `app/api/media/route.ts`:

```ts
import { loadMedia } from '@/src/lib/data/media';
import { respond } from '@/src/lib/data/respond';

export async function GET(request: Request) {
  return respond(await loadMedia(new URL(request.url)));
}
```

In `src/lib/ui/api.ts`, add `import { loadMedia } from '@/src/lib/data/media'` and the route entry `[/^\/api\/media$/, (_, url) => loadMedia(url)],` to `ROUTES`.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit && npm run lint && npx vitest run src/lib` — expected: PASS.

```bash
git add src/lib/ui/types.ts src/lib/media src/lib/data/media.ts app/api/media/route.ts src/lib/ui/api.ts
git commit -m "feat(api): /api/media with recency and heat ranking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: News page

**Files:**
- Create: `components/news/ArticleCard.tsx`, `components/news/SocialCard.tsx`, `components/news/TweetEmbed.tsx`
- Create: `app/news/page.tsx`
- Modify: `components/shell/NavLinks.tsx`, `components/shell/CommandPalette.tsx`

**Interfaces:**
- Consumes: `MediaItem`, `MediaPayload`, `getJson`, `ageLabel` (`src/lib/ui/time.ts`), `PageHeader`, `SegmentedLinks`, `Eyebrow`, `EmptyState`.
- Produces: `ArticleCard({ item, compact? })`, `SocialCard({ item, embed? })`, `TweetEmbed({ url, fallback })`; route `/news?show=articles|social`.

- [ ] **Step 1: Article card**

Create `components/news/ArticleCard.tsx`:

```tsx
import { cn } from '@/lib/utils'
import { ageLabel } from '@/src/lib/ui/time'
import type { MediaItem } from '@/src/lib/ui/types'

/** External article link — source, headline, age, optional thumbnail. */
export function ArticleCard({ item, compact = false }: { item: MediaItem; compact?: boolean }) {
  const age = ageLabel(item.published_at)
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('row-hover flex items-start gap-3.5 rounded-[14px]', compact ? 'px-3 py-2.5' : 'px-3.5 py-3')}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim">
          <span className="truncate">{item.source}</span>
          {age && <span aria-label={`${age} ago`}>· {age}</span>}
        </div>
        <p className={cn('m-0 leading-snug text-text', compact ? 'text-[13.5px]' : 'text-[15px] font-medium')}>{item.title}</p>
        {!compact && item.author && <p className="m-0 mt-1 text-[12.5px] text-mute">{item.author}</p>}
      </div>
      {!compact && item.thumbnail_url && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary publisher hosts; no image proxy
        <img
          src={item.thumbnail_url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-[64px] w-[96px] shrink-0 rounded-[10px] border border-line object-cover"
        />
      )}
    </a>
  )
}
```

- [ ] **Step 2: Tweet embed with fallback**

Create `components/news/TweetEmbed.tsx`:

```tsx
'use client'

import * as React from 'react'

declare global {
  interface Window {
    twttr?: { widgets: { load: (el?: HTMLElement) => Promise<unknown> } }
  }
}

const WIDGETS_SRC = 'https://platform.twitter.com/widgets.js'
let widgetsPromise: Promise<void> | null = null

function loadWidgets(): Promise<void> {
  if (window.twttr?.widgets) return Promise.resolve()
  widgetsPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = WIDGETS_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('widgets.js failed to load'))
    document.head.appendChild(s)
  })
  return widgetsPromise
}

/**
 * Real X post via X's free embed widget. The script loads only when the post
 * scrolls near the viewport; if it can't render (deleted post, blocked script),
 * the fallback shows instead. The blockquote is created imperatively because
 * widgets.js replaces it — React never renders or diffs it.
 */
export function TweetEmbed({ url, fallback }: { url: string; fallback: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        const quote = document.createElement('blockquote')
        quote.className = 'twitter-tweet'
        quote.setAttribute('data-theme', 'dark')
        quote.setAttribute('data-dnt', 'true')
        const a = document.createElement('a')
        a.href = url
        quote.appendChild(a)
        el.replaceChildren(quote)
        loadWidgets()
          .then(() => window.twttr!.widgets.load(el))
          .then(() => new Promise((r) => setTimeout(r, 1500)))
          .then(() => {
            if (!cancelled && !el.querySelector('iframe')) setFailed(true)
          })
          .catch(() => {
            if (!cancelled) setFailed(true)
          })
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [url])

  if (failed) return <>{fallback}</>
  return <div ref={ref} className="min-h-[140px] [&_.twitter-tweet]:my-0!" />
}
```

- [ ] **Step 3: Social card**

Create `components/news/SocialCard.tsx`:

```tsx
import { ageLabel } from '@/src/lib/ui/time'
import type { MediaItem } from '@/src/lib/ui/types'
import { TweetEmbed } from './TweetEmbed'

const KIND_LABEL: Record<MediaItem['kind'], string> = { article: 'Article', reddit: 'Reddit', tweet: 'Post on X', bluesky: 'Bluesky' }

function TextPost({ item }: { item: MediaItem }) {
  const age = ageLabel(item.published_at)
  const stats = [
    item.engagement != null ? `${item.kind === 'reddit' || item.kind === 'tweet' ? '▲' : '♥'} ${item.engagement.toLocaleString('en-US')}` : null,
    item.comments != null ? `${item.comments.toLocaleString('en-US')} comments` : null,
  ].filter(Boolean)
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="row-hover flex flex-col gap-1 rounded-[14px] px-3.5 py-3">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim">
        {KIND_LABEL[item.kind]} · {item.kind === 'bluesky' ? item.author : item.source}
        {age && ` · ${age}`}
      </span>
      <span className="text-[14px] leading-snug text-text">{item.title}</span>
      {stats.length > 0 && <span className="font-mono text-[11px] text-mute">{stats.join(' · ')}</span>}
    </a>
  )
}

/** A social post: X posts embed (when `embed`), everything else renders as text. */
export function SocialCard({ item, embed = true }: { item: MediaItem; embed?: boolean }) {
  if (embed && item.kind === 'tweet' && item.embed_url) {
    return <TweetEmbed url={item.embed_url} fallback={<TextPost item={item} />} />
  }
  return <TextPost item={item} />
}
```

- [ ] **Step 4: The page**

Create `app/news/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { PageHeader } from '@/components/shell/PageHeader'
import { SegmentedLinks } from '@/components/ui/segmented-links'
import { Eyebrow } from '@/components/ui/eyebrow'
import { EmptyState } from '@/components/ui/empty-state'
import { ArticleCard } from '@/components/news/ArticleCard'
import { SocialCard } from '@/components/news/SocialCard'
import { getJson } from '@/src/lib/ui/api'
import type { MediaPayload } from '@/src/lib/ui/types'

// Live data on every request (loaders read the database directly).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'News' }

type Show = 'all' | 'articles' | 'social'

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const params = await searchParams
  const show: Show = params.show === 'articles' || params.show === 'social' ? params.show : 'all'
  const data = await getJson<MediaPayload>('/api/media?limit=40')
  const href = (s: Show) => (s === 'all' ? '/news' : `/news?show=${s}`)

  const articles = data?.articles ?? []
  const social = data?.social ?? []
  const showArticles = show !== 'social'
  const showSocial = show !== 'articles'

  return (
    <div className="page">
      <PageHeader
        title="News"
        subtitle="From around the web · refreshed every 15 minutes"
        actions={
          <SegmentedLinks
            ariaLabel="Show"
            size="sm"
            value={show}
            options={[
              { value: 'all', label: 'All', href: href('all') },
              { value: 'articles', label: 'Articles', href: href('articles') },
              { value: 'social', label: 'Social', href: href('social') },
            ]}
          />
        }
      />
      {!data ? (
        <EmptyState title="News couldn't load" body="The data service didn't respond. Refresh in a moment." />
      ) : articles.length === 0 && social.length === 0 ? (
        <EmptyState title="Nothing new yet" body="Articles and posts from the last week show up here." />
      ) : (
        <div className={`enter grid grid-cols-1 items-start gap-6 lg:gap-[18px] ${showArticles && showSocial ? 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]' : ''}`}>
          {showArticles && (
            <section>
              <Eyebrow aside={`${articles.length}`}>Articles</Eyebrow>
              {articles.length ? (
                <div className="panel p-1.5">{articles.map((a) => <ArticleCard key={a.media_id} item={a} />)}</div>
              ) : (
                <EmptyState title="No articles this week" />
              )}
            </section>
          )}
          {showSocial && (
            <section>
              <Eyebrow aside="hottest first">Social</Eyebrow>
              {social.length ? (
                <div className="flex flex-col gap-2.5">
                  {social.map((s) => (
                    <div key={s.media_id} className="panel p-1.5">
                      <SocialCard item={s} />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No posts yet" />
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Navigation**

In `components/shell/NavLinks.tsx`, add `{ href: '/news', label: 'News' },` between the Schedule and History entries of `LINKS`.
In `components/shell/CommandPalette.tsx`, add `{ href: '/news', label: 'News', hint: 'Articles and social' },` between the Schedule and History entries of `PAGES`.

- [ ] **Step 6: Verify in the browser**

Seed a few rows locally if the table is empty (`npm run sync-media` against a dev database, or insert two rows by hand), then use the `run` skill / `preview_start` to open `/news`. Check, at desktop width and at 390px:
- Articles and Social columns render; the filter switches between All / Articles / Social;
- an X post renders as an embedded post, and a bad `embed_url` (e.g. `https://twitter.com/x/status/1`) falls back to the text card within ~2 seconds;
- no "Verified" text anywhere on the page;
- links open in a new tab.

Run: `npx tsc --noEmit && npm run lint && npm run build` — expected: success.

- [ ] **Step 7: Commit**

```bash
git add components/news app/news/page.tsx components/shell/NavLinks.tsx components/shell/CommandPalette.tsx
git commit -m "feat(ui): News page with articles, embedded X posts and social feed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Home "Buzz" module

**Files:**
- Create: `components/home/BuzzPanel.tsx`
- Modify: `app/home/page.tsx`

**Interfaces:**
- Consumes: `ArticleCard` (`compact`), `SocialCard` (`embed={false}`), `MediaPayload`.
- Produces: `BuzzPanel({ articles, social })`.

- [ ] **Step 1: The panel**

Create `components/home/BuzzPanel.tsx`:

```tsx
import Link from 'next/link'
import { Eyebrow } from '@/components/ui/eyebrow'
import { ArticleCard } from '@/components/news/ArticleCard'
import { SocialCard } from '@/components/news/SocialCard'
import type { MediaItem } from '@/src/lib/ui/types'

/** Top headlines and the hottest posts, linking to /news. Text only — no embeds on Home. */
export function BuzzPanel({ articles, social }: { articles: MediaItem[]; social: MediaItem[] }) {
  if (articles.length === 0 && social.length === 0) return null
  return (
    <div>
      <Eyebrow aside={<Link href="/news" className="hover:text-text">All news →</Link>}>Buzz · from around the web</Eyebrow>
      <div className="panel p-1.5">
        {articles.map((a) => <ArticleCard key={a.media_id} item={a} compact />)}
        {social.map((s) => <SocialCard key={s.media_id} item={s} embed={false} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Place it on Home**

In `app/home/page.tsx`:
- add imports `import { BuzzPanel } from '@/components/home/BuzzPanel'` and `MediaPayload` to the `@/src/lib/ui/types` import;
- extend the `Promise.all` to fetch media:

```tsx
  const [home, insightsRes, roster, media] = await Promise.all([
    getJson<HomePayload>('/api/home'),
    getJson<{ insights: Insight[] }>('/api/insights?scope=between_games&limit=12'),
    getJson<PlayersPayload>('/api/players?include_traded=true'),
    getJson<MediaPayload>('/api/media?limit=3'),
  ])
```

- insert, directly before the `{upcoming.length > 1 && (` section:

```tsx
      {media && (media.articles.length > 0 || media.social.length > 0) && (
        <section className="enter" style={{ ['--i' as string]: 3 }}>
          <BuzzPanel articles={media.articles.slice(0, 3)} social={media.social.slice(0, 2)} />
        </section>
      )}
```

- change the "Up next" section's `style={{ ['--i' as string]: 3 }}` to `4` so the entrance stagger stays in order.

- [ ] **Step 3: Verify and commit**

Preview `/home` at desktop and 390px: the Buzz panel shows up to 3 headlines and 2 posts, "All news →" goes to `/news`, and Home renders unchanged when `media_items` is empty. Run `npx tsc --noEmit && npm run lint && npm run build`.

```bash
git add components/home/BuzzPanel.tsx app/home/page.tsx
git commit -m "feat(ui): Buzz module on Home

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Rollout (operational — needs Luke)

- [ ] **Step 1: Reddit app and Bluesky app password (Luke)** — at https://www.reddit.com/prefs/apps create a **script** app (name "Clippers Command Center", redirect `http://localhost`). Add GitHub Actions secrets: `REDDIT_CLIENT_ID` (under the app name), `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` = `ClippersCommandCenter/1.0 by <reddit username>`. Then, signed in to Bluesky, create a free app password at https://bsky.app/settings/app-passwords (name "Clippers Command Center") and add GitHub Actions secrets `BSKY_HANDLE` (the account handle, e.g. `name.bsky.social`) and `BSKY_APP_PASSWORD` (the app password, never the account password). Bluesky search needs an authenticated session; without these secrets sync-media skips Bluesky.
- [ ] **Step 2: Migrate, then merge (Luke approves)** — apply the migration BEFORE merging, so the first scheduled sync-media run after the merge finds `media_items`. `2026-10-media.sql` isn't on main yet, so run the migration from the branch: `gh workflow run db-migrate.yml --ref insights/v2-build -f file=2026-10-media.sql -f confirm=migrate`; confirm success with `gh run watch`. Then merge the PR.
- [ ] **Step 3: Dry run from Actions** — `gh workflow run sync-media.yml -f dry_run=true`, then read the log (`gh run view --log`). Expected: every RSS source, r/LAClippers and Bluesky report item counts. A Bluesky `FAILED (bluesky session HTTP 401 — check BSKY_HANDLE / BSKY_APP_PASSWORD)` (or any Bluesky session failure) means the credentials are wrong or missing: fix the `BSKY_HANDLE` / `BSKY_APP_PASSWORD` secrets with Luke and re-run. Do not remove the Bluesky source.
- [ ] **Step 4: Real run** — `gh workflow run sync-media.yml`; then `psql "$DATABASE_URL" -c "SELECT kind, COUNT(*) FROM media_items GROUP BY 1"`. Expected: articles ≥ 10, social ≥ 5 on a normal day.
- [ ] **Step 5: Deploy** — `vercel deploy --prod` (CCC deploys via the CLI, not on merge), then open https://clippers.lukeghanna.com/news and `/home` and repeat the Task 6 Step 6 checks in production.
