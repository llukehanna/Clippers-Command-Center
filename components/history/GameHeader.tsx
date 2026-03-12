interface GameHeaderProps {
  homeAbbr: string
  awayAbbr: string
  homeScore: number | null
  awayScore: number | null
  gameDate: string        // ISO date string
  status: string
  isHome: boolean         // is LAC the home team?
}

export function GameHeader({
  homeAbbr,
  awayAbbr,
  homeScore,
  awayScore,
  gameDate,
  status,
  isHome,
}: GameHeaderProps) {
  const lacScore = isHome ? homeScore : awayScore
  const oppScore = isHome ? awayScore : homeScore

  let resultBadge: React.ReactNode = null
  if (lacScore !== null && oppScore !== null) {
    const isWin = lacScore > oppScore
    resultBadge = isWin ? (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-positive/10 text-positive">
        W
      </span>
    ) : (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-negative/10 text-negative">
        L
      </span>
    )
  }

  const formattedDate = new Date(gameDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="rounded-xl border border-white/[0.06] bg-surface px-6 py-5">
      <a
        href="/history"
        className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-4 block"
      >
        &larr; History
      </a>

      {/* Score row */}
      <div className="flex items-center justify-between">
        {/* Away team */}
        <div className="flex items-center gap-4">
          <span className="text-2xl font-bold text-foreground">{awayAbbr}</span>
          <span className="text-4xl font-bold tabular-nums text-foreground">
            {awayScore ?? '—'}
          </span>
        </div>

        {/* Center: vs + result badge */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-muted-foreground text-lg">vs</span>
          {resultBadge}
        </div>

        {/* Home team */}
        <div className="flex items-center gap-4">
          <span className="text-4xl font-bold tabular-nums text-foreground">
            {homeScore ?? '—'}
          </span>
          <span className="text-2xl font-bold text-foreground">{homeAbbr}</span>
        </div>
      </div>

      {/* Date and status */}
      <div className="mt-3 text-sm text-muted-foreground text-center">
        {formattedDate} &middot; {status}
      </div>
    </div>
  )
}
