// Guards for the build-time payload cache directory (PREBUILD_CACHE_DIR), so
// scripts/prebuild/invalidate.ts only ever deletes cache files inside the repo.
// Pure (paths in, verdict out) so it is unit-tested.

import path from 'node:path'

/**
 * Why `dir` can't be used as the payload cache directory, or null when it can.
 * It must be set and resolve (against `cwd`) to a directory strictly inside
 * `repoRoot`: never `/`, the repo root itself, or anywhere outside the repo.
 */
export function cacheDirProblem(dir: string | undefined, repoRoot: string, cwd: string): string | null {
  if (dir === undefined || dir.trim() === '') return 'PREBUILD_CACHE_DIR is not set'
  const abs = path.resolve(cwd, dir)
  const root = path.resolve(repoRoot)
  const rel = path.relative(root, abs)
  if (rel === '') return `PREBUILD_CACHE_DIR is the repo root (${abs}); use a subdirectory such as .prebuild/payloads`
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return `PREBUILD_CACHE_DIR (${abs}) is outside the repo (${root})`
  }
  return null
}

/** A cache entry written by loadThrough (src/lib/prebuild/payload-cache.ts): `<sha1>.json`. */
export function isCacheFile(name: string): boolean {
  return name.length > '.json'.length && name.endsWith('.json')
}

/** A temp file a crashed loadThrough left behind (`<sha1>.json.<pid>.<rand>.tmp`). */
export function isTmpFile(name: string): boolean {
  return name.endsWith('.tmp')
}
