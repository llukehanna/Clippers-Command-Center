import { describe, expect, it } from 'vitest'
import { checkBuild, checkClientData, checkLinks, checkPageCoverage, extractHrefs, resolveLink, type LinkTargets } from './check-build'

const range = <T,>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i))

const fullRoutes = [
  '/',
  '/home',
  '/schedule',
  '/players',
  '/players/table',
  '/players/traded',
  '/players/all-time',
  '/franchise',
  '/news',
  '/history',
  ...range(4700, (i) => `/history/${10000 + i}`),
  ...range(57, (i) => `/history/season/${1970 + i}`),
  ...range(865, (i) => `/players/${i + 1}`),
  ...range(418, (i) => `/franchise/trades/2020-01-01-${i.toString(16).padStart(6, '0')}`),
]

describe('checkBuild', () => {
  it('passes a full build', () => {
    expect(checkBuild({ routes: fullRoutes, assetFileCount: 9000 })).toEqual([])
  })

  it('names each count threshold that is missed', () => {
    const cases: Array<[RegExp, string]> = [
      [/^\/history\/\d+$/, 'history game pages'],
      [/^\/players\/\d+$/, 'player pages'],
      [/^\/franchise\/trades\//, 'trade pages'],
      [/^\/history\/season\/\d+$/, 'history season pages'],
    ]
    for (const [family, name] of cases) {
      const problems = checkBuild({ routes: fullRoutes.filter((r) => !family.test(r)), assetFileCount: 9000 })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain(name)
    }
  })

  it('counts only the id pages of a family', () => {
    // /players/table etc. and /history/season/<id> must not count toward the id-page thresholds.
    const routes = [
      ...fullRoutes.filter((r) => !/^\/players\/\d+$/.test(r)),
      ...range(399, (i) => `/players/${i}/season/2024`),
    ]
    expect(checkBuild({ routes, assetFileCount: 9000 })[0]).toBe('player pages (/players/<id>): 0 < 400')
  })

  it('applies the exact thresholds', () => {
    const at = (n: number) => [
      ...fullRoutes.filter((r) => !/^\/history\/\d+$/.test(r)),
      ...range(n, (i) => `/history/${i}`),
    ]
    expect(checkBuild({ routes: at(4000), assetFileCount: 19000 })).toEqual([])
    expect(checkBuild({ routes: at(3999), assetFileCount: 9000 })).toHaveLength(1)
  })

  it('requires the top-level pages', () => {
    for (const page of ['/home', '/schedule', '/players', '/franchise', '/news']) {
      const problems = checkBuild({ routes: fullRoutes.filter((r) => r !== page), assetFileCount: 9000 })
      expect(problems).toEqual([expect.stringContaining(page)])
    }
  })

  it('caps the static asset file count at 19,000', () => {
    expect(checkBuild({ routes: fullRoutes, assetFileCount: 19001 })).toEqual([expect.stringContaining('19000')])
  })

  it('fails a sample-size build on every family', () => {
    const sample = [
      '/home', '/schedule', '/players', '/franchise', '/news',
      ...range(6, (i) => `/history/${i}`),
      ...range(6, (i) => `/players/${i}`),
      ...range(6, (i) => `/franchise/trades/t${i}`),
      ...range(6, (i) => `/history/season/${2020 + i}`),
    ]
    expect(checkBuild({ routes: sample, assetFileCount: 300 })).toHaveLength(4)
  })
})

describe('extractHrefs', () => {
  it('returns root-relative hrefs, entity-decoded, and skips external and protocol-relative ones', () => {
    const html =
      '<a href="/history/1">x</a><a href="https://example.com/a">y</a><a href="//cdn.example.com/x">z</a>' +
      '<link rel="icon" href="/icon1.png?icon1.abc.png"/><a href="/players?mode=all-time&amp;view=table">t</a>' +
      "<a href='/franchise'>f</a>"
    expect(extractHrefs(html)).toEqual(['/history/1', '/icon1.png?icon1.abc.png', '/players?mode=all-time&view=table', '/franchise'])
  })
})

describe('resolveLink', () => {
  const targets: LinkTargets = {
    routes: new Set(['/', '/home', '/history/1', '/players', '/icon1.png', '/franchise/person/nba%3A1641715', '/franchise/person/griffbl01']),
    publicFiles: new Set(['/teams/lac.png', '/data/home.json', '/icons/icon-192.png', '/favicon.ico']),
  }

  it.each([
    '/home',
    '/home/',
    '/history/1#box',
    '/history/1?_rsc=abc',
    '/icon1.png?icon1.abc.png',
    '/franchise/person/nba:1641715',
    '/franchise/person/nba%3A1641715',
    '/_next/static/chunks/abc.js',
    '/teams/lac.png',
    '/data/home.json',
    '/icons/icon-192.png',
    '/live',
    '/api/live',
    '/api/media',
    '/players/nba/1629029',
    '/history/123/opengraph-image',
    '/schedule/4530',
    '/schedule/4530/ics',
  ])('resolves %s', (href) => {
    expect(resolveLink(href, targets)).toBeNull()
  })

  it.each([
    ['/history/2', 'no prerendered page'],
    ['/franchise/person/nobody', 'no prerendered page'],
    ['/api/home', 'no prerendered page'],
    ['/data/missing.json', 'no prerendered page'],
    ['/schedule/abc', 'no prerendered page'],
    ['/players?mode=all-time', 'legacy query URL'],
    ['/history?season_id=2024&home_away=home', 'legacy query URL'],
    ['/news?show=articles', 'legacy query URL'],
    ['/franchise?type=trade', 'legacy query URL'],
    ['/players/7?season=2024', 'legacy query URL'],
  ])('rejects %s (%s)', (href, reason) => {
    expect(resolveLink(href, targets)).toContain(reason)
  })

  it('treats a malformed escape as unresolved instead of throwing', () => {
    expect(resolveLink('/history/%E0%A4%A', targets)).toContain('no prerendered page')
  })

  it('in a full (strict) build, resolves /schedule/<id> only via its own page or the /history page the Worker falls back to', () => {
    const strict = { ...targets, routes: new Set([...targets.routes, '/schedule/30', '/schedule/30/ics']), strict: true }
    expect(resolveLink('/schedule/30', strict)).toBeNull()
    expect(resolveLink('/schedule/30/ics', strict)).toBeNull()
    expect(resolveLink('/schedule/1', strict)).toBeNull() // /history/1 is prerendered
    expect(resolveLink('/schedule/1/ics', strict)).toBeNull()
    expect(resolveLink('/schedule/4530', strict)).toContain('nor a /history page')
    expect(resolveLink('/schedule/4530/ics', strict)).toContain('nor a /history page')
  })

  it('tolerates links into a dynamic route family when given its patterns (sample builds)', () => {
    const tolerant = { ...targets, dynamicRoutes: ['/history/[game_id]', '/franchise/moves/[type]/[season]'] }
    expect(resolveLink('/history/2', tolerant)).toBeNull()
    expect(resolveLink('/franchise/moves/trade/2020', tolerant)).toBeNull()
    expect(resolveLink('/franchise/moves/trade', tolerant)).toContain('no prerendered page')
    expect(resolveLink('/history/2/extra', tolerant)).toContain('no prerendered page')
    expect(resolveLink('/players?mode=all-time', tolerant)).toContain('legacy query URL')
  })
})

describe('checkLinks', () => {
  const targets: LinkTargets = { routes: new Set(['/home']), publicFiles: new Set() }

  it('passes when every link resolves', () => {
    expect(checkLinks([{ from: '/home', href: '/home' }], targets)).toEqual([])
  })

  it('counts unresolved links once each and lists at most 20 with a page that links them', () => {
    const links = [
      ...range(30, (i) => ({ from: '/home', href: `/history/${i}` })),
      { from: '/news', href: '/history/0' },
      { from: '/news', href: '/home' },
    ]
    const problems = checkLinks(links, targets)
    expect(problems[0]).toBe('30 unresolved internal links (first 20):')
    expect(problems).toHaveLength(21)
    expect(problems[1]).toBe('  /history/0 (no prerendered page or file) ← /home')
  })
})

describe('checkPageCoverage', () => {
  it('passes when the HTML covers the page routes and links were checked', () => {
    expect(checkPageCoverage({ pageRoutes: 155, htmlFiles: 155, linkCount: 16000 })).toEqual([])
    expect(checkPageCoverage({ pageRoutes: 100, htmlFiles: 50, linkCount: 1 })).toEqual([])
  })

  it('fails when no HTML was found, so the link check cannot pass vacuously', () => {
    const problems = checkPageCoverage({ pageRoutes: 155, htmlFiles: 0, linkCount: 0 })
    expect(problems.join('\n')).toContain('no prerendered HTML')
  })

  it('fails when the HTML covers less than half of the page routes', () => {
    expect(checkPageCoverage({ pageRoutes: 100, htmlFiles: 49, linkCount: 500 })).toEqual([
      expect.stringContaining('49 HTML files for 100 prerendered pages'),
    ])
  })

  it('fails when HTML exists but no internal link was checked', () => {
    expect(checkPageCoverage({ pageRoutes: 10, htmlFiles: 10, linkCount: 0 })).toEqual([
      expect.stringContaining('0 internal links'),
    ])
  })
})

describe('checkClientData', () => {
  const seasons = JSON.stringify({ seasons: [{ season_id: 2024 }, { season_id: 2026 }, { season_id: 2025 }] })
  const all: Record<string, string> = {
    '/data/history/seasons.json': seasons,
    '/data/players.json': '{}',
    '/data/players/all-time.json': '{}',
    '/data/franchise/trades.json': '{}',
    '/data/franchise/people.json': '{}',
    '/data/home.json': '{}',
    '/data/history/games/2026.json': '{}',
    '/data/history/games/2025.json': '{}',
  }
  const reader = (files: Record<string, string>) => (rel: string) => (Object.hasOwn(files, rel) ? files[rel] : null)

  it('passes when every expected file exists and parses', () => {
    expect(checkClientData(reader(all))).toEqual([])
  })

  it('names each missing file, including the latest two seasons’ games', () => {
    const files = { ...all }
    delete files['/data/home.json']
    delete files['/data/history/games/2026.json']
    const problems = checkClientData(reader(files))
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toContain('/data/home.json')
    expect(problems.join('\n')).toContain('/data/history/games/2026.json')
  })

  it('fails on an unparseable file', () => {
    expect(checkClientData(reader({ ...all, '/data/players.json': '{"trunc' }))).toEqual([
      expect.stringContaining('/data/players.json'),
    ])
  })

  it('fails with one clear problem when public/data is absent', () => {
    const problems = checkClientData(reader({}))
    expect(problems).toEqual([expect.stringContaining('npm run prebuild:client-data')])
  })
})
