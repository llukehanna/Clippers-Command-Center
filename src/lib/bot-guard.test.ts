import { describe, expect, it } from 'vitest'
import { blockedReason } from './bot-guard'

const req = (path: string, agent: string, asn?: number) => {
  const r = new Request(`https://clippers.lukeghanna.com${path}`, { headers: { 'user-agent': agent } }) as Request & { cf?: { asn?: number } }
  if (asn != null) r.cf = { asn }
  return r
}
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

describe('blockedReason', () => {
  it('blocks the Meta-network crawler that posed as Chrome', () => {
    expect(blockedReason(req('/franchise?season=1982&type=draft&player=mcgruro01', CHROME, 32934))).toMatch(/32934/)
    expect(blockedReason(req('/players/189', CHROME, 32934))).toMatch(/32934/)
  })
  it("keeps Meta's link previews for plain page URLs", () => {
    const fb = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
    expect(blockedReason(req('/history/4520', fb, 32934))).toBeNull()
    expect(blockedReason(req('/history/4520/opengraph-image', fb, 32934))).toBeNull()
    expect(blockedReason(req('/franchise?season=1982', fb, 32934))).not.toBeNull()
  })
  it('blocks crawlers that ignore robots.txt by user agent, anywhere', () => {
    expect(blockedReason(req('/home', 'meta-externalagent/1.1', 15169))).toBe('agent')
    expect(blockedReason(req('/home', 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)'))).toBe('agent')
  })
  it('always serves robots.txt, and leaves people and other crawlers alone', () => {
    expect(blockedReason(req('/robots.txt', CHROME, 32934))).toBeNull()
    expect(blockedReason(req('/home', CHROME, 7922))).toBeNull()
    expect(blockedReason(req('/home', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 15169))).toBeNull()
  })
})
