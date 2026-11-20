import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const loadSchedule = vi.fn()
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/src/lib/data/schedule', () => ({ loadSchedule: (...args: unknown[]) => loadSchedule(...args) }))

const { getJson, clearMemo } = await import('./api')

describe('getJson memory cache', () => {
  beforeEach(() => {
    clearMemo()
    loadSchedule.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('serves a repeat request from memory within the TTL', async () => {
    loadSchedule.mockResolvedValue({ status: 200, body: { games: [1] } })
    expect(await getJson('/api/schedule')).toEqual({ games: [1] })
    expect(await getJson('/api/schedule')).toEqual({ games: [1] })
    expect(loadSchedule).toHaveBeenCalledTimes(1)
  })

  it('reloads after the TTL', async () => {
    loadSchedule.mockResolvedValue({ status: 200, body: { games: [1] } })
    await getJson('/api/schedule')
    vi.advanceTimersByTime(61_000)
    loadSchedule.mockResolvedValue({ status: 200, body: { games: [2] } })
    expect(await getJson('/api/schedule')).toEqual({ games: [2] })
    expect(loadSchedule).toHaveBeenCalledTimes(2)
  })

  it('never caches failures', async () => {
    loadSchedule.mockResolvedValueOnce({ status: 503, body: { error: 'down' } })
    expect(await getJson('/api/schedule')).toBeNull()
    loadSchedule.mockResolvedValueOnce({ status: 200, body: { games: [3] } })
    expect(await getJson('/api/schedule')).toEqual({ games: [3] })
    expect(loadSchedule).toHaveBeenCalledTimes(2)
  })
})

describe('getJson in prebuild mode', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getjson-prebuild-'))
    process.env.PREBUILD_CACHE_DIR = dir
    clearMemo()
    loadSchedule.mockReset()
  })
  afterEach(() => {
    delete process.env.PREBUILD_CACHE_DIR
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns the body and reads through the file cache', async () => {
    loadSchedule.mockResolvedValue({ status: 200, body: { games: [1] } })
    expect(await getJson('/api/schedule')).toEqual({ games: [1] })
    expect(await getJson('/api/schedule')).toEqual({ games: [1] })
    expect(loadSchedule).toHaveBeenCalledTimes(1)
  })

  it('404 is cached and returns null', async () => {
    loadSchedule.mockResolvedValue({ status: 404, body: { error: 'x' } })
    expect(await getJson('/api/schedule')).toBeNull()
    expect(await getJson('/api/schedule')).toBeNull()
    expect(loadSchedule).toHaveBeenCalledTimes(1)
  })

  it('fails closed on 5xx and loader errors', async () => {
    loadSchedule.mockResolvedValue({ status: 503, body: null })
    await expect(getJson('/api/schedule')).rejects.toThrow('prebuild')
    loadSchedule.mockRejectedValue(new Error('db down'))
    await expect(getJson('/api/schedule')).rejects.toThrow('db down')
  })
})

describe('getJson in any other production build', () => {
  beforeEach(() => {
    process.env.NEXT_PHASE = 'phase-production-build'
    clearMemo()
    loadSchedule.mockReset()
  })
  afterEach(() => {
    delete process.env.NEXT_PHASE
  })

  it('returns the body, and null on a 4xx', async () => {
    loadSchedule.mockResolvedValueOnce({ status: 200, body: { games: [1] } })
    expect(await getJson('/api/schedule')).toEqual({ games: [1] })
    loadSchedule.mockResolvedValueOnce({ status: 404, body: { error: 'x' } })
    expect(await getJson('/api/schedule')).toBeNull()
  })

  it('fails closed on 5xx and loader errors instead of returning an empty state', async () => {
    loadSchedule.mockResolvedValue({ status: 503, body: null })
    await expect(getJson('/api/schedule')).rejects.toThrow('503')
    loadSchedule.mockRejectedValue(new Error('db down'))
    await expect(getJson('/api/schedule')).rejects.toThrow('db down')
  })
})
