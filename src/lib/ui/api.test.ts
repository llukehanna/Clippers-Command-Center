import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
