import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cacheFile, loadThrough, readCached } from './payload-cache'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-cache-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('loadThrough', () => {
  it('miss loads, writes, and returns', async () => {
    const load = vi.fn().mockResolvedValue({ status: 200, body: { a: 1 } })
    const out = await loadThrough(dir, '/api/x', load)
    expect(out).toMatchObject({ path: '/api/x', status: 200, body: { a: 1 } })
    expect(fs.existsSync(cacheFile(dir, '/api/x'))).toBe(true)
    expect(readCached(dir, '/api/x')?.status).toBe(200)
    expect(fs.readdirSync(dir)).toHaveLength(1)
  })

  it('hit does not call the loader', async () => {
    const load = vi.fn().mockResolvedValue({ status: 200, body: { a: 1 } })
    await loadThrough(dir, '/api/x', load)
    const again = await loadThrough(dir, '/api/x', load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(again.body).toEqual({ a: 1 })
  })

  it('500 throws and writes nothing', async () => {
    const load = vi.fn().mockResolvedValue({ status: 500, body: null })
    await expect(loadThrough(dir, '/api/x', load)).rejects.toThrow('prebuild: /api/x → 500')
    expect(fs.readdirSync(dir)).toHaveLength(0)
  })

  it('loader throw propagates and writes nothing', async () => {
    const load = vi.fn().mockRejectedValue(new Error('db down'))
    await expect(loadThrough(dir, '/api/x', load)).rejects.toThrow('db down')
    expect(fs.readdirSync(dir)).toHaveLength(0)
  })

  it('404 is cached', async () => {
    const load = vi.fn().mockResolvedValue({ status: 404, body: { error: 'nope' } })
    expect((await loadThrough(dir, '/api/x', load)).status).toBe(404)
    await loadThrough(dir, '/api/x', load)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('two concurrent misses for one path both resolve', async () => {
    const load = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return { status: 200, body: { big: 'x'.repeat(100_000) } }
    })
    const [a, b] = await Promise.all([loadThrough(dir, '/api/x', load), loadThrough(dir, '/api/x', load)])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(readCached(dir, '/api/x')?.status).toBe(200)
    expect(fs.readdirSync(dir)).toEqual([path.basename(cacheFile(dir, '/api/x'))])
  })
})
