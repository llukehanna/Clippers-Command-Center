import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { Chip } from '@/components/ui/chip'
import { Eyebrow } from '@/components/ui/eyebrow'
import { ScoutCard } from '@/components/insights/kit/ScoutCard'
import { MatchupNotes } from '@/components/insights/kit/MatchupNotes'
import type { InsightCardData, MatchupNote } from '@/src/lib/insights/card'
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
  href?: string
  /** Venue for away games (home games always read Intuit Dome). */
  arena?: string | null
  /** Pregame insight feeds (Home): scouting cards and matchup notes. Empty blocks are hidden. */
  insights?: { scouting: InsightCardData[]; notes: MatchupNote[] }
  className?: string
}

/** The hero card for the next Clippers game: matchup, tip-off, countdown, line. */
export function NextGamePanel({ game, context, eyebrow = 'Next game', href, arena, insights, className }: NextGamePanelProps) {
  if (!game) {
    return (
      <Panel variant="hero" className={className}>
        <div className="relative flex min-h-[260px] flex-col justify-between gap-6 p-6 sm:p-7">
          <p className="label-mono !text-mute">{eyebrow}</p>
          <div>
            <p className="m-0 text-[24px] font-semibold tracking-[-0.03em]">No games on the calendar yet</p>
            <p className="m-0 mt-1.5 max-w-[46ch] text-[14px] text-mute">The schedule shows up here as soon as the league publishes it.</p>
          </div>
        </div>
      </Panel>
    )
  }

  const home = game.home_away === 'home'
  const odds = game.odds
  const label = `Game preview: Clippers ${home ? 'vs' : 'at'} ${teamName(game.opponent_abbr)}, ${formatDay(game.game_date)}`
  const body = (
    <div className="relative p-5 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <p className="label-mono !text-mute">{eyebrow}</p>
        {game.is_preseason ? <Chip tone="blue">Preseason</Chip> : context}
      </div>

      {/* Side by side at every width; on phones each team stacks logo over name. */}
      <div className="my-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:my-7 sm:gap-5">
        <TeamMark
          abbr="LAC"
          size="xl"
          name="Clippers"
          meta={home ? 'Home' : 'Away'}
          className="max-sm:flex-col max-sm:gap-2.5 max-sm:text-center"
          priority
        />
        <span className="font-mono text-[12px] tracking-[0.1em] text-dim">{home ? 'VS' : '@'}</span>
        <TeamMark
          abbr={game.opponent_abbr}
          size="xl"
          name={teamName(game.opponent_abbr)}
          meta={home ? 'Away' : `Home · ${teamCity(game.opponent_abbr)}`}
          align="right"
          className="sm:justify-self-end max-sm:flex-col max-sm:gap-2.5 max-sm:text-center"
          priority
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-5">
        <div>
          <div className="text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">{formatDay(game.game_date)}</div>
          <div className="mt-1 text-[14.5px] text-mute">
            {formatTip(game.start_time_utc)}
            {/* Preseason "home" games are often at neutral sites. */}
            {home && !game.is_preseason ? ' · Intuit Dome' : ''}
            {!home && arena ? ` · ${arena}` : ''}
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

      {insights && insights.scouting.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <Eyebrow as="h3" aside={`${insights.scouting.length} verified`}>
            Scouting the {teamName(game.opponent_abbr)}
          </Eyebrow>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            {insights.scouting.map((card) => (
              <ScoutCard key={card.insight_id} card={card} />
            ))}
          </div>
        </div>
      )}

      {insights && insights.notes.length > 0 && (
        <div className="mt-5">
          <Eyebrow as="h3">Matchup notes</Eyebrow>
          <MatchupNotes notes={insights.notes} />
        </div>
      )}

      {href && (
        <div aria-hidden className="mt-5 flex justify-end">
          <span className="font-mono text-[12px] text-mute transition-colors duration-300 group-hover:text-text">
            Game preview <span className="inline-block transition-transform duration-300 ease-premium group-hover:translate-x-0.5">→</span>
          </span>
        </div>
      )}
    </div>
  )

  // With an href the whole card opens the game preview, like every other game card.
  if (href) {
    return (
      <Panel
        as={Link}
        href={href}
        aria-label={label}
        variant="hero"
        className={cn('group block transition-colors duration-300 hover:border-line-2', className)}
      >
        {body}
      </Panel>
    )
  }
  return (
    <Panel variant="hero" className={className}>
      {body}
    </Panel>
  )
}
