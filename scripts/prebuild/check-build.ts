// Sanity checks around the prebuilt-site production build (spec §5: fail closed).
//
//   tsx scripts/prebuild/check-build.ts --client-data
//     Before `next build` (first step of `npm run cf-build`): every public/data
//     file client components fetch exists and parses. Production builds set
//     NEXT_PUBLIC_STATIC_DATA=1 (.env.production), so a build without them
//     would ship pages whose client fetches 404.
//
//   tsx scripts/prebuild/check-build.ts
//     After `npm run cf-build` (last step of `npm run build:prebuilt`): the
//     prerender manifest has every page family at full size, the Worker's
//     static asset count is under the cap, and every internal link in the
//     prerendered HTML resolves. Always fails without PREBUILD_FULL=1, so a
//     sample build (spec §5d) can never deploy.
//
// Exits 1 with the problems. The check functions are pure and unit-tested.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { legacyRedirect } from '@/src/lib/legacy-redirect'
import { clientDataApiPaths, dataFileFor } from './client-data-files'

// ── Route counts and asset cap ────────────────────────────────────────────────

/** Workers allow 20,000 static asset files per version; keep headroom. */
export const MAX_ASSET_FILES = 19_000

const MIN_FAMILY: Array<{ name: string; pattern: RegExp; min: number }> = [
  { name: 'history game pages (/history/<id>)', pattern: /^\/history\/\d+$/, min: 4_000 },
  { name: 'player pages (/players/<id>)', pattern: /^\/players\/\d+$/, min: 400 },
  { name: 'trade pages (/franchise/trades/<slug>)', pattern: /^\/franchise\/trades\/[^/]+$/, min: 150 },
  { name: 'history season pages (/history/season/<id>)', pattern: /^\/history\/season\/\d+$/, min: 50 },
]

const REQUIRED_PAGES = ['/home', '/schedule', '/players', '/franchise', '/news']

/** Problems with a production build's prerendered routes and asset count; empty = pass. */
export function checkBuild(input: { routes: string[]; assetFileCount: number }): string[] {
  const problems: string[] = []
  for (const { name, pattern, min } of MIN_FAMILY) {
    const n = input.routes.filter((r) => pattern.test(r)).length
    if (n < min) problems.push(`${name}: ${n} < ${min}`)
  }
  const routes = new Set(input.routes)
  for (const page of REQUIRED_PAGES) if (!routes.has(page)) problems.push(`missing prerendered page ${page}`)
  if (input.assetFileCount > MAX_ASSET_FILES) {
    problems.push(`static asset files: ${input.assetFileCount} > ${MAX_ASSET_FILES}`)
  }
  return problems
}

// ── Internal links ────────────────────────────────────────────────────────────

export interface LinkTargets {
  /** Prerendered routes (prerender-manifest.json `routes`). */
  routes: ReadonlySet<string>
  /** Static files served as Worker assets, as URL paths ('/teams/lac.png'). */
  publicFiles: ReadonlySet<string>
  /**
   * Dynamic route patterns ('/history/[game_id]'). Only for sample builds,
   * which prerender a few params per family: a link into a family counts as
   * resolved. Full builds leave this out, so every link must hit a real page.
   */
  dynamicRoutes?: readonly string[]
  /**
   * Full builds: a /schedule/<id> link must reach a real page, its own
   * prerendered preview or the /history/<id> page the Worker's fallback
   * redirects to (an id with neither 404s at runtime too). Otherwise any
   * /schedule/<digits> link counts as served by that fallback.
   */
  strict?: boolean
}

/** Served at request time by the Worker (live pipeline, DB allowlist, or a redirect), never prerendered. */
const RUNTIME_ROUTES: RegExp[] = [
  /^\/live$/,
  /^\/api\/live$/,
  /^\/api\/media$/,
  /^\/players\/nba\/[^/]+$/,
  /^\/history\/[^/]+\/opengraph-image$/,
]

/** A schedule page or calendar file the Worker 302s to /history/<id> when it isn't prerendered (worker.ts scheduleFallback). */
const SCHEDULE_FALLBACK = /^\/schedule\/(\d+)(?:\/ics)?$/

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** The root-relative href values in an HTML document (entity-decoded; external and protocol-relative skipped). */
export function extractHrefs(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/\shref=(?:"([^"]*)"|'([^']*)')/g)) {
    const href = decodeEntities(m[1] ?? m[2])
    if (href.startsWith('/') && !href.startsWith('//')) out.push(href)
  }
  return out
}

/** A path as routes are compared: percent-decoded, no trailing slash. Null when an escape is malformed. */
function normPath(p: string): string | null {
  let s: string
  try {
    s = decodeURIComponent(p)
  } catch {
    return null
  }
  return s.length > 1 ? s.replace(/\/+$/, '') : s
}

const normalizedRoutes = new WeakMap<ReadonlySet<string>, Set<string>>()

function routeSet(routes: ReadonlySet<string>): Set<string> {
  let set = normalizedRoutes.get(routes)
  if (!set) {
    set = new Set<string>()
    for (const r of routes) set.add(normPath(r) ?? r)
    normalizedRoutes.set(routes, set)
  }
  return set
}

function patternRegex(route: string): RegExp {
  const body = route
    .split('/')
    .map((seg) => {
      if (/^\[\[?\.\.\.[^\]]+\]\]?$/.test(seg)) return '.+'
      if (/^\[[^\]]+\]$/.test(seg)) return '[^/]+'
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return new RegExp(`^${body}$`)
}

/**
 * Null when an internal href resolves to something the deployed Worker serves
 * (a prerendered page, a static file, or a runtime route); otherwise why not.
 * Query strings and #hashes are ignored, except that a URL still carrying a
 * legacy query key (one worker.ts 301s) is always a problem.
 */
export function resolveLink(href: string, targets: LinkTargets): string | null {
  const url = new URL(href, 'https://ccc.local')
  const legacy = legacyRedirect(url)
  if (legacy) return `legacy query URL, now ${legacy}`

  const raw = url.pathname
  if (raw.startsWith('/_next/')) return null
  const p = normPath(raw)
  const candidates = p === null ? [raw] : [p, raw]
  const routes = routeSet(targets.routes)
  for (const c of candidates) {
    if (routes.has(c) || targets.publicFiles.has(c)) return null
    if (RUNTIME_ROUTES.some((re) => re.test(c))) return null
    if (targets.dynamicRoutes?.some((r) => patternRegex(r).test(c))) return null
    const game = c.match(SCHEDULE_FALLBACK)
    if (game && (!targets.strict || routes.has(`/history/${game[1]}`))) return null
  }
  return SCHEDULE_FALLBACK.test(p ?? raw) ? 'no prerendered page, nor a /history page to fall back to' : 'no prerendered page or file'
}

/** Problems for the links that don't resolve (each href once, the first 20 listed with a page linking it); empty = pass. */
export function checkLinks(links: Iterable<{ from: string; href: string }>, targets: LinkTargets): string[] {
  const seen = new Map<string, string | null>()
  const bad: Array<{ href: string; reason: string; from: string }> = []
  for (const { from, href } of links) {
    if (seen.has(href)) continue
    const reason = resolveLink(href, targets)
    seen.set(href, reason)
    if (reason) bad.push({ href, reason, from })
  }
  if (bad.length === 0) return []
  const shown = bad.slice(0, 20)
  return [
    `${bad.length} unresolved internal links${bad.length > shown.length ? ` (first ${shown.length})` : ''}:`,
    ...shown.map((b) => `  ${b.href} (${b.reason}) ← ${b.from}`),
  ]
}

/**
 * Problems that would make the link check pass vacuously: no HTML scanned, far
 * fewer HTML files than prerendered pages, or no links found. Empty = pass.
 */
export function checkPageCoverage(input: { pageRoutes: number; htmlFiles: number; linkCount: number }): string[] {
  const { pageRoutes, htmlFiles, linkCount } = input
  if (htmlFiles === 0) return ['no prerendered HTML found in .next/server/app: the link check had nothing to scan']
  const problems: string[] = []
  if (htmlFiles * 2 < pageRoutes) {
    problems.push(`only ${htmlFiles} HTML files for ${pageRoutes} prerendered pages (< 50%): the link check would miss most pages`)
  }
  if (linkCount === 0) problems.push(`0 internal links found in ${htmlFiles} HTML files: the link check checked nothing`)
  return problems
}

// ── public/data (before the build) ────────────────────────────────────────────

const SEASONS_FILE = dataFileFor('/api/history/seasons')

/**
 * Problems with the prebuilt client data; empty = pass. `read` returns a
 * /data file's text ('/data/home.json'), or null when it doesn't exist.
 */
export function checkClientData(read: (rel: string) => string | null): string[] {
  const seasonsText = read(SEASONS_FILE)
  if (seasonsText === null) {
    return [`public${SEASONS_FILE} is missing: run \`npm run prebuild:client-data\` before a production build`]
  }
  let files: string[]
  try {
    files = clientDataApiPaths(JSON.parse(seasonsText)).map(dataFileFor)
  } catch (err) {
    return [`public${SEASONS_FILE} is unusable: ${(err as Error).message}`]
  }
  const problems: string[] = []
  for (const rel of files) {
    const text = read(rel)
    if (text === null) {
      problems.push(`missing public${rel}`)
      continue
    }
    try {
      JSON.parse(text)
    } catch {
      problems.push(`unparseable public${rel}`)
    }
  }
  return problems
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.isFile()) out.push(p)
  }
  return out
}

/** Where the static-assets incremental cache lives inside the Worker assets (@opennextjs/cloudflare CACHE_DIR). */
const NEXT_CACHE_ASSETS = 'cdn-cgi/_next_cache'

const toUrlPath = (base: string, file: string) => '/' + path.relative(base, file).split(path.sep).join('/')

function fail(title: string, problems: string[], hint?: string): never {
  console.error(`${title}:`)
  for (const p of problems) console.error(p.startsWith('  ') ? p : `- ${p}`)
  if (hint) console.error(hint)
  process.exit(1)
}

function checkClientDataCli(root: string) {
  const pub = path.join(root, 'public')
  const problems = checkClientData((rel) => {
    try {
      return fs.readFileSync(path.join(pub, rel), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  })
  if (problems.length) {
    fail(
      'public/data check failed',
      problems,
      'Production builds (NEXT_PUBLIC_STATIC_DATA=1) need every /data file. Run `npm run prebuild:client-data` ' +
        '(PREBUILD_CACHE_DIR and DATABASE_URL set), or `npm run build:prebuilt`, which does it first.',
    )
  }
  console.log('public/data: complete')
}

function checkBuildCli(root: string) {
  const manifestFile = path.join(root, '.next', 'prerender-manifest.json')
  const assetsDir = path.join(root, '.open-next', 'assets')
  if (!fs.existsSync(manifestFile) || !fs.existsSync(assetsDir)) {
    fail('check-build', [`no build output (${manifestFile} or ${assetsDir} is missing): run \`npm run cf-build\` first`])
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as {
    routes: Record<string, { routeType?: string }>
    dynamicRoutes?: Record<string, unknown>
  }
  const routes = Object.keys(manifest.routes)
  const assets = walk(assetsDir).filter((f) => !toUrlPath(assetsDir, f).startsWith(`/${NEXT_CACHE_ASSETS}/`))
  // `opennextjs-cloudflare deploy` copies .open-next/cache (one entry per
  // prerendered route) into the assets at cdn-cgi/_next_cache before uploading,
  // so the deployed count is both.
  const cacheEntries = walk(path.join(root, '.open-next', 'cache'))
  const assetFileCount = assets.length + cacheEntries.length
  const full = process.env.PREBUILD_FULL === '1'

  const problems = checkBuild({ routes, assetFileCount })
  if (!full) problems.unshift('PREBUILD_FULL is not 1: this is a sample build, which must never deploy')

  const appDir = path.join(root, '.next', 'server', 'app')
  const htmlFiles = walk(appDir).filter((f) => f.endsWith('.html'))
  let linkCount = 0
  function* links() {
    for (const file of htmlFiles) {
      const from = toUrlPath(appDir, file).replace(/\.html$/, '').replace(/^\/index$/, '/')
      for (const href of extractHrefs(fs.readFileSync(file, 'utf8'))) {
        linkCount++
        yield { from, href }
      }
    }
  }
  const targets: LinkTargets = {
    routes: new Set(routes),
    publicFiles: new Set(assets.map((f) => toUrlPath(assetsDir, f))),
    // Sample builds prerender a few pages per family: tolerate links into a family.
    dynamicRoutes: full ? undefined : Object.keys(manifest.dynamicRoutes ?? {}),
    strict: full,
  }
  problems.push(...checkLinks(links(), targets))
  // Page routes have HTML; route handlers (ics, OG images, icons) don't.
  const pageRoutes = Object.values(manifest.routes).filter((r) => r.routeType === undefined || r.routeType === 'page').length
  problems.push(...checkPageCoverage({ pageRoutes, htmlFiles: htmlFiles.length, linkCount }))

  const count = (re: RegExp) => routes.filter((r) => re.test(r)).length
  const stats: Array<[string, number | string]> = [
    ['Prerendered routes', routes.length],
    ['History game pages', count(/^\/history\/\d+$/)],
    ['Player pages', count(/^\/players\/\d+$/)],
    ['Trade pages', count(/^\/franchise\/trades\/[^/]+$/)],
    ['History season pages', count(/^\/history\/season\/\d+$/)],
    ['Static asset files', `${assetFileCount} / ${MAX_ASSET_FILES} (${assets.length} files + ${cacheEntries.length} prerender cache entries)`],
    ['Internal links checked', `${linkCount} in ${htmlFiles.length} pages${full ? '' : ' (sample: dynamic families tolerated)'}`],
  ]
  for (const [k, v] of stats) console.log(`${k}: ${v}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = ['### Build check', '', '| | |', '|---|---|', ...stats.map(([k, v]) => `| ${k} | ${v} |`), '']
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n')
  }

  if (problems.length) fail('check-build failed (nothing deploys)', problems)
  console.log('check-build: ok')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd()
  if (process.argv.includes('--client-data')) checkClientDataCli(root)
  else checkBuildCli(root)
}
