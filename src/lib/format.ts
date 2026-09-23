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
