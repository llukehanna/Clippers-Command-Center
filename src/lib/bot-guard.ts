// src/lib/bot-guard.ts
// Turns away crawlers that ignore robots.txt before Next.js runs, so they cost
// neither CPU nor database queries (worker.ts calls this first).
//
// Why: on the Workers free plan each request gets ~10 ms of CPU and the
// account 100k Hyperdrive queries a day. On 2026-11-19 a crawler on Meta's
// network (AS32934), sending a desktop-Chrome user agent, walked every
// /franchise?season=…&type=…&player=… combination (hundreds of thousands of
// URLs, each a full render with queries) and exhausted the day's queries, so
// every page lost its data until the reset. Meta did the same in October on
// Vercel, as meta-externalagent. Its link-preview fetcher (facebookexternalhit)
// is still allowed for plain page URLs, so links shared on Facebook, Instagram
// and WhatsApp keep their previews.
//
// Runtime-agnostic (Request in, reason out) so it can be unit tested in Node.

/** Networks whose crawlers ignore robots.txt. */
const BLOCKED_ASNS: Record<number, string> = {
  32934: 'Meta Platforms',
}

/** Link-preview fetchers: allowed from blocked networks for plain URLs. */
const PREVIEW_AGENTS = /facebookexternalhit|meta-externalfetcher|facebookcatalog|WhatsApp|Facebot/i

/** User agents that crawl regardless of robots.txt, from anywhere. */
const BLOCKED_AGENTS = /meta-externalagent|Bytespider|ImagesiftBot|Scrapy|PetalBot/i

type CfRequest = Request & { cf?: { asn?: number } }

/** Why this request is refused, or null to serve it. */
export function blockedReason(request: CfRequest): string | null {
  const url = new URL(request.url)
  if (url.pathname === '/robots.txt') return null
  const agent = request.headers.get('user-agent') ?? ''
  if (BLOCKED_AGENTS.test(agent)) return 'agent'
  const asn = request.cf?.asn
  if (asn != null && BLOCKED_ASNS[asn]) {
    // A preview fetches the shared page (and its image), never a filtered view.
    if (PREVIEW_AGENTS.test(agent) && url.search === '') return null
    return `asn ${asn} (${BLOCKED_ASNS[asn]})`
  }
  return null
}

export function blockedResponse(): Response {
  return new Response('Automated crawling of this site is not permitted. See /robots.txt.\n', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
