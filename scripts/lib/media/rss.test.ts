import { describe, it, expect } from 'vitest';
import { FEEDS, parseFeed, type FeedConfig } from './rss';

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
  it('strips the last " - …" segment even when it is not the <source> publisher', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>Inside the Clippers' 'risk tolerance' - The Athletic</title>
      <link>https://news.google.com/rss/articles/nyt</link>
      <pubDate>Mon, 20 Oct 2026 05:00:00 GMT</pubDate>
      <source url="https://www.nytimes.com">The New York Times</source>
    </item></channel></rss>`;
    const [item] = parseFeed(xml, google);
    expect(item).toMatchObject({ title: "Inside the Clippers' 'risk tolerance'", source: 'The New York Times' });
    expect(item.dedupKey).toBe('article:inside the clippers risk tolerance');
  });
  it('uses the stripped suffix as the source when there is no <source>', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>Clippers - Nuggets preview - Clips Nation</title>
      <link>https://news.google.com/rss/articles/cn</link>
      <pubDate>Mon, 20 Oct 2026 05:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const [item] = parseFeed(xml, google);
    expect(item).toMatchObject({ title: 'Clippers - Nuggets preview', source: 'Clips Nation' });
  });
  it('keeps numeric-looking titles as strings', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>007</title>
      <link>https://www.clipsnation.com/007</link>
      <pubDate>Mon, 20 Oct 2026 05:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const [item] = parseFeed(xml, clipsNation);
    expect(item.title).toBe('007');
    expect(item.dedupKey).toBe('article:007');
  });
  it('strips HTML from titles', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title><![CDATA[Clippers <em>rout</em>   the Nuggets]]></title>
      <link>https://www.clipsnation.com/rout</link>
      <pubDate>Mon, 20 Oct 2026 05:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const [item] = parseFeed(xml, clipsNation);
    expect(item.title).toBe('Clippers rout the Nuggets');
  });
  it('falls back to a URL dedup key when the title has no Latin characters', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>快船队击败掘金队</title>
      <link>https://sports.example.cn/clippers/1</link>
      <pubDate>Mon, 20 Oct 2026 05:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const [item] = parseFeed(xml, clipsNation);
    expect(item.dedupKey).toBe('article:url:https://sports.example.cn/clippers/1');
  });
  it('requires a Clippers mention from the LA Times feed', () => {
    expect(FEEDS.find((f) => f.source === 'LA Times')?.requireMention).toBe(true);
    expect(FEEDS.find((f) => f.source === 'Google News')).toMatchObject({ requireMention: false, splitPublisher: true });
  });
  it('returns nothing for malformed XML', () => {
    expect(parseFeed('<not-a-feed>', espn)).toEqual([]);
  });
});
