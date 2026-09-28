import { describe, it, expect } from 'vitest'
import { americanToProb, noVigProbabilities, formatSpread, formatMoneyline, formatSigned } from './odds'

describe('odds', () => {
  it('converts american odds to implied probability', () => {
    expect(americanToProb(-150)).toBeCloseTo(0.6, 4)
    expect(americanToProb(130)).toBeCloseTo(100 / 230, 4)
  })

  it('removes the vig so both sides sum to 1', () => {
    const p = noVigProbabilities(-158, 132)!
    expect(p.a + p.b).toBeCloseTo(1, 6)
    expect(p.a).toBeGreaterThan(0.55)
    expect(noVigProbabilities(null, 120)).toBeNull()
  })

  it('formats spreads, moneylines and signed numbers', () => {
    expect(formatSpread(-4.5)).toBe('−4.5')
    expect(formatSpread(3)).toBe('+3')
    expect(formatSpread(0)).toBe('PK')
    expect(formatSpread(null)).toBe('—')
    expect(formatMoneyline(-185)).toBe('−185')
    expect(formatMoneyline(132)).toBe('+132')
    expect(formatSigned(2.84, 1)).toBe('+2.8')
    expect(formatSigned(0)).toBe('0')
  })
})
