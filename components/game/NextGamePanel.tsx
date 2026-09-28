import * as React from 'react'
import { Panel } from '@/components/ui/panel'
import { TeamMark } from '@/components/ui/team-mark'
import { Countdown } from './Countdown'
import { OddsStrip } from './OddsStrip'
import { formatMoneyline, formatSpread } from '@/src/lib/ui/odds'
import { formatDay, formatTip } from '@/src/lib/ui/time'
import { teamCity, teamName } from '@/src/lib/ui/teams'
import type { ScheduleGame } from '@/src/lib/ui/types'

interface NextGamePanelProps {
  game: ScheduleGame | null
  context?: React.ReactNode
  eyebrow?: string
  className?: string
}

/** The hero card for the next Clippers game: matchup, tip-off, countdown, line. */
export function NextGamePanel({ game, context, eyebrow = 'Next game', className }: NextGamePanelProps) {
  if (!game) {
    return (
      <Panel variant="hero" className={className}>
        <div className="relative flex min-h-[260px] flex-col justify-between gap-6 p-6 sm:p-7">
          <p className="label-mono !text-mute">{eyebrow}</p>
          <div>
            <p className="m-0 text-[24px] font-semibold tracking-[-0.03em]">No games on the calendar yet</p>
            <p className="m-0 mt-1.5 max-w-[46ch] text-[14px] text-mute">
              The schedule shows up here as soon as the league publishes it.
            </p>
          </div>
        </div>
      </Panel>
    )
  }

  const home = game.home_away === 'home'
  const odds = game.odds
  return (
    <Panel variant="hero" className={className}>
      <div className="relative p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <p className="label-mono !text-mute">{eyebrow}</p>
          {context}
        </div>

        <div className="my-6 grid grid-cols-1 items-center gap-4 sm:my-7 sm:grid-cols-[1fr_auto_1fr] sm:gap-5">
          <TeamMark abbr="LAC" size="xl" name="Clippers" meta={home ? 'Home' : 'Away'} priority />
          <span className="hidden font-mono text-[12px] tracking-[0.1em] text-dim sm:block">{home ? 'VS' : '@'}</span>
          <TeamMark
            abbr={game.opponent_abbr}
            size="xl"
            name={teamName(game.opponent_abbr)}
            meta={home ? 'Away' : `Home · ${teamCity(game.opponent_abbr)}`}
            align="right"
            className="sm:justify-self-end [@media(max-width:639px)]:flex-row [@media(max-width:639px)]:text-left"
            priority
          />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-5">
          <div>
            <div className="text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">{formatDay(game.game_date)}</div>
            <div className="mt-1 text-[14.5px] text-mute">
              {formatTip(game.start_time_utc)}
              {home ? ' · Intuit Dome' : ''}
            </div>
          </div>
          <Countdown tipoff={game.start_time_utc} />
        </div>

        {odds && (odds.spread != null || odds.moneyline != null || odds.over_under != null) && (
          <OddsStrip
            className="mt-5"
            items={[
              { label: 'Spread', value: odds.spread == null ? '—' : `LAC ${formatSpread(odds.spread)}` },
              { label: 'Moneyline', value: formatMoneyline(odds.moneyline) },
              { label: 'Total', value: odds.over_under == null ? '—' : String(odds.over_under) },
            ]}
          />
        )}
      </div>
    </Panel>
  )
}
