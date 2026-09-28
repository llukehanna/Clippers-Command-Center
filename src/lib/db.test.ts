import { afterEach, describe, expect, it, vi } from 'vitest'

describe('db without DATABASE_URL', () => {
  const original = process.env.DATABASE_URL

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original
    vi.resetModules()
  })

  it('imports without throwing (so builds without a database succeed)', async () => {
    delete process.env.DATABASE_URL
    vi.resetModules()
    const mod = await import('./db')
    expect(mod.LAC_NBA_TEAM_ID).toBe(13)
  })

  it('throws a clear error on first use', async () => {
    delete process.env.DATABASE_URL
    vi.resetModules()
    const { sql } = await import('./db')
    expect(() => sql`select 1`).toThrow(/DATABASE_URL is not set/)
    expect(() => sql.unsafe('select 1')).toThrow(/DATABASE_URL is not set/)
  })
})
