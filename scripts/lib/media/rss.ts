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
  // Clips Nation ('https://www.clipsnation.com/rss/index.xml') and NBA.com
  // ('https://www.nba.com/clippers/rss.xml') were dropped 2026-09-27: both
  // now 404 (Clips Nation's own <link rel="alternate"> still advertises the
  // same dead URL; NBA.com serves its SPA shell instead of XML at that path)
  // and no working replacement feed could be found.
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
