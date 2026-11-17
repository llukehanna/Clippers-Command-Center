import { describe, it, expect } from 'vitest'
import { teamName } from './teams'

describe('teamName', () => {
  it('prefers the era name when given', () => {
    expect(teamName('SEA', 'SuperSonics')).toBe('SuperSonics')
  })
  it('falls back to the current lookup', () => {
    expect(teamName('OKC')).toBe('Thunder')
    expect(teamName('OKC', null)).toBe('Thunder')
  })
})
