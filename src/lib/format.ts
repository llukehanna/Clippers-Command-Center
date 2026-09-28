export function formatClock(isoStr: string): string {
  const match = isoStr.match(/PT(?:(\d+)M)?(?:([\d.]+)S)?/)
  if (!match) return isoStr
  const mins = parseInt(match[1] ?? '0', 10)
  const secs = Math.floor(parseFloat(match[2] ?? '0'))
  return `${mins}:${String(secs).padStart(2, '0')}`
}

const INSIGHT_CATEGORY_LABELS: Record<string, string> = {
  league_comparison: 'League Rank',
  opponent_context: 'Scouting Report',
  rare_event: 'Rare Performance',
  milestone: 'Milestone',
  streak: 'Streak',
  year_over_year: 'Year over Year',
  run: 'Scoring Run',
  clutch: 'Clutch',
}

/** Display label for an insight category ("league_comparison" → "League Rank"). */
export function insightCategoryLabel(category: string): string {
  return (
    INSIGHT_CATEGORY_LABELS[category] ??
    category
      .split('_')
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ')
  )
}

/**
 * Betting line with an explicit sign: spread "3.5" → "+3.5", moneyline "150"
 * → "+150"; negative and non-numeric values ("PK", "—") pass through.
 */
export function formatSignedLine(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const s = String(value).trim()
  const n = Number(s)
  if (!Number.isFinite(n) || s.startsWith('+') || s.startsWith('-')) return s
  return n > 0 ? `+${s}` : s
}
