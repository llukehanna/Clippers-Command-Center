import { afterEach, describe, expect, it, vi } from 'vitest'
import { staticParams } from './static-params'

const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

describe('staticParams', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('returns everything in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(staticParams(ten)).toEqual(ten)
  })

  it('returns everything with PREBUILD_FULL=1', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PREBUILD_FULL', '1')
    expect(staticParams(ten)).toEqual(ten)
  })

  it('returns first 3 + last 3 otherwise', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PREBUILD_FULL', '')
    expect(staticParams(ten)).toEqual([1, 2, 3, 8, 9, 10])
    expect(staticParams([1, 2])).toEqual([1, 2])
  })
})
