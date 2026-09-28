import Link from 'next/link'
import { TeamLogo } from '@/components/ui/team-mark'
import { ScheduleChips } from './ScheduleChips'
import { formatSpread } from '@/src/lib/ui/odds'
import { formatDay, formatTip } from '@/src/lib/ui/time'
import { teamName } from '@/src/lib/ui/teams'
import type { ScheduleAnnotation } from '@/src/lib/ui/schedule'
import type { ScheduleGame } from '@/src/lib/ui/types'

/** Next few games as compact cards (2 across on phones, 4 on desktop). */
export function UpNextList({ games }: { games: Array<ScheduleGame & { annotation: ScheduleAnnotation }> }) {
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 lg:grid-cols-4 lg:gap-3">
      {games.map((g) => (
        <li key={g.game_id}>
          <Link
            href="/schedule"
            className="panel group flex h-full flex-col gap-3 p-4 transition-colors duration-300 hover:border-line-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-mute">{formatDay(g.game_date)}</span>
              <span className="font-mono text-[11px] text-dim">{g.home_away === 'home' ? 'HOME' : 'AWAY'}</span>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <TeamLogo abbr={g.opponent_abbr} size="md" />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium tracking-[-0.01em]">
                  <span className="text-mute">{g.home_away === 'home' ? 'vs' : '@'}</span> {teamName(g.opponent_abbr)}
                </div>
                <div className="font-mono text-[11.5px] text-dim tabular-nums">
                  {formatTip(g.start_time_utc)}
                  {g.odds?.spread != null && ` · LAC ${formatSpread(g.odds.spread)}`}
                </div>
              </div>
            </div>
            <div className="mt-auto flex min-h-[20px] flex-wrap gap-1.5">
              <ScheduleChips annotation={g.annotation} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
