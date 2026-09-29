import { TeamLogo } from '@/components/ui/team-mark'

/** LAC win probability: implied by the live moneyline (vig removed), or the live model's estimate. */
export function WinProbabilityBar({
  lacProb,
  oppAbbr,
  source = 'moneyline',
}: {
  lacProb: number
  oppAbbr: string
  source?: 'moneyline' | 'model'
}) {
  const lac = Math.round(lacProb * 100)
  return (
    <div className="relative grid gap-2 border-t border-line px-5 py-3.5 sm:px-8">
      <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-mute tabular-nums">
        <span className="flex items-center gap-2">
          <TeamLogo abbr="LAC" size="xs" />
          LAC {lac}%
          {/* Every value names its source at every width; phones get the short form of the moneyline note. */}
          {source === 'model' ? (
            <span className="text-dim"> · model estimate</span>
          ) : (
            <span className="text-dim">
              {' · '}
              <span className="sm:hidden">moneyline</span>
              <span className="hidden sm:inline">implied by live moneyline</span>
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {oppAbbr} {100 - lac}%
          <TeamLogo abbr={oppAbbr} size="xs" />
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={lac}
        aria-label="Clippers win probability"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-naval to-pacific transition-[width] duration-700 ease-premium"
          style={{ width: `${lac}%` }}
        />
      </div>
    </div>
  )
}
