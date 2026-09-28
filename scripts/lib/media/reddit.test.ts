import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redditToItems, redditRssToItems, tweetUrl, insiderPost } from './reddit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_FIXTURE = fs.readFileSync(path.join(__dirname, '__fixtures__/reddit-laclippers-hot.rss'), 'utf8');

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
  it('recognizes x.com/i/web status links', () => {
    expect(tweetUrl('https://x.com/i/web/status/1847000000000000001')).toEqual({ id: '1847000000000000001', embedUrl: 'https://twitter.com/i/web/status/1847000000000000001' });
    expect(tweetUrl('https://twitter.com/i/web/status/42?s=20')).toEqual({ id: '42', embedUrl: 'https://twitter.com/i/web/status/42' });
  });
  it('recognizes fxtwitter, vxtwitter and fixupx links', () => {
    expect(tweetUrl('https://fxtwitter.com/ShamsCharania/status/111')).toEqual({ id: '111', embedUrl: 'https://twitter.com/ShamsCharania/status/111' });
    expect(tweetUrl('https://vxtwitter.com/LAClippers/status/222')).toEqual({ id: '222', embedUrl: 'https://twitter.com/LAClippers/status/222' });
    expect(tweetUrl('https://fixupx.com/LAClippers/status/333')).toEqual({ id: '333', embedUrl: 'https://twitter.com/LAClippers/status/333' });
    expect(tweetUrl('https://notfxtwitter.com/LAClippers/status/444')).toBeNull();
  });
});

describe('insiderPost', () => {
  it('detects the insider tags from the real captured feed', () => {
    expect(insiderPost('[Jake Fischer] Former first-round pick Blake Wesley is signing a one-year deal with the LA Clippers, sources say.'))
      .toEqual({ insider: 'Jake Fischer', text: 'Former first-round pick Blake Wesley is signing a one-year deal with the LA Clippers, sources say.' });
    expect(insiderPost('[Keith Smith] The LA Clippers have signed Hunter Sallis and Jason Preston to Exhibit 10 contracts'))
      .toEqual({ insider: 'Keith Smith', text: 'The LA Clippers have signed Hunter Sallis and Jason Preston to Exhibit 10 contracts' });
    expect(insiderPost('[Law Murray] I’m told that the LA Clippers will waive Jamarion Sharp, opening up a two way contract'))
      .toEqual({ insider: 'Law Murray', text: 'I’m told that the LA Clippers will waive Jamarion Sharp, opening up a two way contract' });
    expect(insiderPost('[Fischer] The Clippers have waived Johni Broome, per source.'))
      .toEqual({ insider: 'Fischer', text: 'The Clippers have waived Johni Broome, per source.' });
    expect(insiderPost('[Vorkunov] If league investigators find proof that the Bucks and Trent are guilty of what the Clippers and Leonard were guilty of, the punishment could be equally severe, if not worse.'))
      .toEqual({ insider: 'Vorkunov', text: 'If league investigators find proof that the Bucks and Trent are guilty of what the Clippers and Leonard were guilty of, the punishment could be equally severe, if not worse.' });
    expect(insiderPost('[Windhorst] “Brandon Ingram had surgery in the offseason on his foot, on his heel. We don’t have an update on how he’s gonna be. We’re gonna hear at media day where he’s at his heel.”'))
      .toEqual({ insider: 'Windhorst', text: 'Brandon Ingram had surgery in the offseason on his foot, on his heel. We don’t have an update on how he’s gonna be. We’re gonna hear at media day where he’s at his heel.' });
    expect(insiderPost('[TheRinger / Pina] Clippers rank 26th in preseason power rankings: “The Clippers won’t make the play-in or anything”'))
      .toEqual({ insider: 'TheRinger / Pina', text: 'Clippers rank 26th in preseason power rankings: “The Clippers won’t make the play-in or anything”' });
  });
  it('rejects generic bracket tags', () => {
    expect(insiderPost('[Highlight] Kawhi dunk')).toBeNull();
    expect(insiderPost('[OC] my art')).toBeNull();
    expect(insiderPost('[Post Game Thread] …')).toBeNull();
    expect(insiderPost('[Highlights] Kawhi and-1')).toBeNull();
    expect(insiderPost('[Game Thread] Clippers vs Nuggets')).toBeNull();
    expect(insiderPost('[Discussion] What now')).toBeNull();
  });
  it('returns null when there is no bracket', () => {
    expect(insiderPost("Kawhi's 27.9 PPG last season were the most by any player 34 or older this century")).toBeNull();
  });
  it('returns null for bracket content with disallowed characters', () => {
    expect(insiderPost('[NBA @ TNT] some text')).toBeNull();
    expect(insiderPost('[Team 1] some text')).toBeNull();
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
  it('turns an insider screenshot post into a tweet item with the insider as author, even without a real tweet link', () => {
    const items = redditToItems({ data: { children: [
      post({ id: 'ins1', title: '[Jake Fischer] Blake Wesley signs a one-year deal, sources say.', author: 'doinnothin',
             url: 'https://i.redd.it/screenshot.png', thumbnail: 'https://b.thumbnail.redditmedia.com/x.jpg',
             preview: { images: [{ source: { url: 'https://preview.redd.it/screenshot.png' } }] } }),
    ] } });
    expect(items[0]).toMatchObject({
      kind: 'tweet', dedupKey: 'reddit:ins1', title: 'Blake Wesley signs a one-year deal, sources say.',
      author: 'Jake Fischer', embedUrl: null, thumbnailUrl: 'https://preview.redd.it/screenshot.png',
    });
  });
  it('leaves non-insider posts unaffected', () => {
    const items = redditToItems({ data: { children: [post({})] } });
    expect(items[0]).toMatchObject({ kind: 'reddit', title: 'Kawhi drops 41', author: 'fan1' });
  });
  it('drops weekly/daily discussion threads and assigns 1-based feedRank among kept posts', () => {
    const items = redditToItems({ data: { children: [
      post({ id: '1', title: 'Weekly Discussion Thread- July 23, 2026' }),
      post({ id: '2' }),
      post({ id: '3', title: 'Daily Discussion — Oct 20' }),
      post({ id: '4' }),
    ] } });
    expect(items.map((i) => ({ dedupKey: i.dedupKey, feedRank: i.feedRank }))).toEqual([
      { dedupKey: 'reddit:2', feedRank: 1 },
      { dedupKey: 'reddit:4', feedRank: 2 },
    ]);
  });
});

describe('redditRssToItems', () => {
  it('parses the real captured feed', () => {
    const items = redditRssToItems(REAL_FIXTURE);
    expect(items.length).toBeGreaterThanOrEqual(15);
    expect(items[0].feedRank).toBe(1);
    expect(items.map((i) => i.feedRank)).toEqual(items.map((_, i) => i + 1));
    expect(items.some((i) => /weekly discussion thread/i.test(i.title))).toBe(false);
    expect(items.every((i) => i.url.startsWith('https://www.reddit.com/r/LAClippers/comments/'))).toBe(true);
    expect(items.every((i) => i.author == null || !i.author.startsWith('/u/'))).toBe(true);
    expect(items.some((i) => i.thumbnailUrl)).toBe(true);
  });
  it('detects at least 4 insider screenshot posts from the real feed, with the right insiders and thumbnails set', () => {
    const items = redditRssToItems(REAL_FIXTURE);
    const insiders = items.filter((i) => i.kind === 'tweet');
    expect(insiders.length).toBeGreaterThanOrEqual(4);
    const byAuthor = new Map(insiders.map((i) => [i.author, i]));
    for (const name of ['Jake Fischer', 'Keith Smith', 'Law Murray', 'Fischer', 'Vorkunov', 'Windhorst', 'TheRinger / Pina']) {
      expect(byAuthor.has(name)).toBe(true);
      expect(byAuthor.get(name)!.thumbnailUrl).toBeTruthy();
    }
  });
  it('turns a [link] to an X status into a tweet item (non-insider title)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
      <entry>
        <author><name>/u/fan1</name></author>
        <content type="html">&lt;span&gt;&lt;a href=&quot;https://x.com/ShamsCharania/status/123&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt;</content>
        <id>t3_xyz1</id>
        <link href="https://www.reddit.com/r/LAClippers/comments/xyz1/shams_report/" />
        <published>2026-09-27T12:00:00+00:00</published>
        <title>Shams posted the report</title>
      </entry>
    </feed>`;
    const [item] = redditRssToItems(xml);
    expect(item).toMatchObject({
      kind: 'tweet', dedupKey: 'tweet:123', embedUrl: 'https://twitter.com/ShamsCharania/status/123',
      url: 'https://www.reddit.com/r/LAClippers/comments/xyz1/shams_report/', author: 'fan1', title: 'Shams posted the report', feedRank: 1,
    });
  });
  it('prefers the insider as author/title even when the post also links to a real tweet', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
      <entry>
        <author><name>/u/fan1</name></author>
        <content type="html">&lt;span&gt;&lt;a href=&quot;https://x.com/ShamsCharania/status/123&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt;</content>
        <id>t3_xyz1</id>
        <link href="https://www.reddit.com/r/LAClippers/comments/xyz1/shams_report/" />
        <published>2026-09-27T12:00:00+00:00</published>
        <title>[Shams] Clippers sign a guy</title>
      </entry>
    </feed>`;
    const [item] = redditRssToItems(xml);
    expect(item).toMatchObject({
      kind: 'tweet', dedupKey: 'tweet:123', embedUrl: 'https://twitter.com/ShamsCharania/status/123',
      url: 'https://www.reddit.com/r/LAClippers/comments/xyz1/shams_report/', author: 'Shams', title: 'Clippers sign a guy', feedRank: 1,
    });
  });
  it('throws when the response has no Atom feed root (e.g. a block page)', () => {
    expect(() => redditRssToItems('<html><body>blocked</body></html>')).toThrow('reddit rss: response is not an Atom feed');
  });
  it('throws for malformed XML with no feed root', () => {
    expect(() => redditRssToItems('<not-a-feed>')).toThrow('reddit rss: response is not an Atom feed');
  });
  it('returns [] for a real feed whose only entries are discussion threads', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <author><name>/u/AutoModerator</name></author>
        <content type="html">&lt;span&gt;&lt;a href=&quot;https://www.reddit.com/r/LAClippers/comments/abc/weekly_discussion_thread/&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt;</content>
        <id>t3_abc</id>
        <link href="https://www.reddit.com/r/LAClippers/comments/abc/weekly_discussion_thread/" />
        <published>2026-09-27T12:00:00+00:00</published>
        <title>Weekly Discussion Thread- Sept 27, 2026</title>
      </entry>
    </feed>`;
    expect(redditRssToItems(xml)).toEqual([]);
  });
});
