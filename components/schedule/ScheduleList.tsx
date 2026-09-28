import { Panel } from '@/components/ui/panel'
import { TeamLogo } from '@/components/ui/team-mark'
import { ScheduleChips } from '@/components/game/ScheduleChips'
import { formatMoneyline, formatSpread } from '@/src/lib/ui/odds'
import { formatTip } from '@/src/lib/ui/time'
import { teamCity, teamName } from '@/src/lib/ui/teams'
import type { ScheduleAnnotation } from '@/src/lib/ui/schedule'
import type { ScheduleGame } from '@/src/lib/ui/types'

type Row = ScheduleGame & { annotation: ScheduleAnnotation }

function dayParts(date: string) {
  const d = new Date(`${date}T12:00:00Z`)
  return {
    dow: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    day: d.getUTCDate(),
  }
}

/** One month of games. Rows reflow to two lines on phones. */
export function ScheduleMonth({ label, games }: { label: string; games: Row[] }) {
  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
        <h2 className="m-0 text-[18px] font-semibold tracking-[-0.02em]">{label}</h2>
        <span className="font-mono text-[11.5px] text-dim">
          {games.length} game{games.length === 1 ? '' : 's'} · {games.filter((g) => g.home_away === 'home').length} home
        </span>
      </div>
      <Panel className="p-1.5">
        <ol className="m-0 list-none p-0">
          {games.map((g) => {
            const { dow, day } = dayParts(g.game_date)
            const home = g.home_away === 'home'
            const opp = home ? g.away_team : g.home_team
            const odds = g.odds
            return (
              <li
                key={g.game_id}
                className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-[14px] px-3 py-3 sm:grid-cols-[52px_minmax(0,1.4fr)_110px_minmax(0,1fr)_150px] sm:gap-x-4 [&+&]:border-t [&+&]:border-line"
              >
                <div className="row-span-2 text-center leading-none sm:row-span-1">
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">{dow}</div>
                  <div className="mt-1 text-[20px] font-semibold tracking-[-0.02em] tabular-nums">{day}</div>
                </div>

                <div className="flex min-w-0 items-center gap-3">
                  <TeamLogo abbr={g.opponent_abbr} size="md" />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium tracking-[-0.01em]">
                      <span className="text-mute">{home ? 'vs' : '@'}</span> {opp?.name ?? teamName(g.opponent_abbr)}
                    </div>
                    <div className="truncate font-mono text-[11.5px] text-dim">
                      {home ? 'Intuit Dome' : opp?.city ?? teamCity(g.opponent_abbr)}
                    </div>
                  </div>
                </div>

                <div className="text-right font-mono text-[12.5px] text-mute tabular-nums sm:text-left">{formatTip(g.start_time_utc)}</div>

                <div className="col-start-2 col-end-4 flex flex-wrap gap-1.5 sm:col-auto">
                  <ScheduleChips annotation={g.annotation} />
                </div>

                <div className="hidden text-right font-mono text-[12px] text-mute tabular-nums sm:block">
                  {odds && (odds.spread != null || odds.moneyline != null) ? (
                    <>
                      <span className="text-text">LAC {formatSpread(odds.spread)}</span>
                      {odds.moneyline != null && <span className="text-dim"> · {formatMoneyline(odds.moneyline)}</span>}
                      {odds.over_under != null && <div className="text-dim">O/U {odds.over_under}</div>}
                    </>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      </Panel>
    </section>
  )
}
