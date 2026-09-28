// Betting-line math and formatting for display. No betting logic — the odds
// are context, shown the way a broadcast would.

const MINUS = '−'

/** Implied probability of an American moneyline (vig included). */
export function americanToProb(ml: number): number {
  return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100)
}

/**
 * Both sides' implied probabilities with the bookmaker margin removed, so
 * they sum to 1. Null when either line is missing.
 */
export function noVigProbabilities(
  mlA: number | null | undefined,
  mlB: number | null | undefined,
): { a: number; b: number } | null {
  if (mlA == null || mlB == null || !Number.isFinite(mlA) || !Number.isFinite(mlB)) return null
  const a = americanToProb(mlA)
  const b = americanToProb(mlB)
  const total = a + b
  if (total <= 0) return null
  return { a: a / total, b: b / total }
}

/** "+4.5", "−3", "0"; "—" when missing. Uses a true minus sign. */
export function formatSigned(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const rounded = Number(v.toFixed(digits))
  if (rounded === 0) return '0'
  const body = Math.abs(rounded).toFixed(digits)
  return rounded > 0 ? `+${body}` : `${MINUS}${body}`
}

/** Point spread: "−4.5", "+3", "PK" for a pick'em. */
export function formatSpread(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v === 0) return 'PK'
  return formatSigned(v, Number.isInteger(v) ? 0 : 1)
}

/** Moneyline: "−185", "+132". */
export function formatMoneyline(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return formatSigned(Math.round(v), 0)
}
