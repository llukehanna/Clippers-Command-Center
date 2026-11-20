// Build-time read-through cache of loader results, one JSON file per path.
// Used only while PREBUILD_CACHE_DIR is set (the build in CI): `next build`
// prerenders in several worker processes, so a path may be loaded by more than
// one process at once. Writes are tmp + rename (atomic on one filesystem), so a
// reader never sees a partial file; concurrent writers of the same path write
// identical content and the last rename wins.
//
// Node-only (fs/crypto): never import this from the request-time path.

import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ApiResult } from '@/src/lib/data/result'

export interface CachedPayload {
  path: string
  status: number
  body: unknown
  fetchedAt: string
}

export function cacheFile(dir: string, p: string): string {
  return path.join(dir, `${createHash('sha1').update(p).digest('hex')}.json`)
}

export function readCached(dir: string, p: string): CachedPayload | null {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(dir, p), 'utf8')) as CachedPayload
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function loadThrough(
  dir: string,
  p: string,
  load: (p: string) => Promise<ApiResult>,
): Promise<CachedPayload> {
  const hit = readCached(dir, p)
  if (hit) return hit

  const result = await load(p)
  if (result.status >= 500) throw new Error(`prebuild: ${p} → ${result.status}`)

  const payload: CachedPayload = { path: p, status: result.status, body: result.body, fetchedAt: new Date().toISOString() }
  fs.mkdirSync(dir, { recursive: true })
  const file = cacheFile(dir, p)
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(payload))
    fs.renameSync(tmp, file)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
  return payload
}
