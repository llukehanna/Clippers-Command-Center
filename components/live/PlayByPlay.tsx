'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { Segmented } from '@/components/ui/segmented'
import { TeamLogo } from '@/components/ui/team-mark'
import { periodLabel } from '@/src/lib/ui/live'
import type { LivePlay } from '@/src/lib/types/live-state'

const SHOWN = 12
const MAX_KEPT = 400

type Filter = 'all' | 'scoring' | 'lac'

/**
 * Every play this page has seen, newest first. Each update carries only the
 * newest plays, so the list keeps the earlier ones it already received (a
 * corrected play replaces its old version).
 */
function useAccumulatedPlays(plays: LivePlay[], gameKey: string): LivePlay[] {
  const [seen, setSeen] = React.useState<{ key: string; byNumber: Map<number, LivePlay> }>(() => ({ key: gameKey, byNumber: new Map() }))
  // Merged during render (React's "adjust state when a prop changes" pattern):
  // an effect would show the shorter list for a frame first.
  const base = seen.key === gameKey ? seen.byNumber : new Map<number, LivePlay>()
  const missing = plays.some((p) => base.get(p.action_number) !== p)
  if (missing || seen.key !== gameKey) {
    const next = new Map(base)
    for (const p of plays) next.set(p.action_number, p)
    if (next.size > MAX_KEPT) {
      for (const k of [...next.keys()].sort((a, b) => a - b).slice(0, next.size - MAX_KEPT)) next.delete(k)
    }
    setSeen({ key: gameKey, byNumber: next })
    return [...next.values()].sort((a, b) => b.action_number - a.action_number)
  }
  return [...base.values()].sort((a, b) => b.action_number - a.action_number)
}

function isScoring(play: LivePlay, prev: LivePlay | undefined): boolean {
  if (!prev) return /\bmakes\b|\(\d+ PTS\)/i.test(play.description)
  return play.score_home !== prev.score_home || play.score_away !== prev.score_away
}

/** The game's plays, newest first: all of them, scoring plays only, or the Clippers'. */
export function PlayByPlay({
  plays,
  gameKey,
  lacAbbr,
  oppAbbr,
  lacHome,
}: {
  plays: LivePlay[]
  gameKey: string
  lacAbbr: string
  oppAbbr: string
  lacHome: boolean
}) {
  const all = useAccumulatedPlays(plays, gameKey)
  const [filter, setFilter] = React.useState<Filter>('all')
  const [expanded, setExpanded] = React.useState(false)

  // Substitutions are noise in a feed fans skim; the rotation panel covers them.
  const rows = all
    .map((p, i) => ({ play: p, scoring: isScoring(p, all[i + 1]) }))
    .filter(({ play }) => play.action_type !== 'substitution')
    .filter(({ play, scoring }) => (filter === 'scoring' ? scoring : filter === 'lac' ? play.team_tricode === lacAbbr : true))
  const shown = expanded ? rows : rows.slice(0, SHOWN)

  return (
    <div>
      <Segmented
        className="mb-3"
        size="sm"
        ariaLabel="Which plays"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'scoring', label: 'Scoring' },
          { value: 'lac', label: lacAbbr },
        ]}
      />
      <Panel className="p-2 sm:p-3">
        {shown.length === 0 ? (
          <p className="m-0 p-3 text-[14px] text-mute">Plays show up here as they happen.</p>
        ) : (
          <ol className="m-0 grid list-none p-0" aria-live="polite" aria-relevant="additions">
            {shown.map(({ play, scoring }) => {
              const lacScore = lacHome ? play.score_home : play.score_away
              const oppScore = lacHome ? play.score_away : play.score_home
              return (
                <li
                  key={play.action_number}
                  className="grid grid-cols-[4.25rem_1.25rem_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-[10px] px-2 py-2 hover:bg-white/[0.03] sm:px-3"
                >
                  <span className="pt-px font-mono text-[11.5px] tabular-nums text-dim">
                    {periodLabel(play.period)} {play.clock}
                  </span>
                  <span className="pt-px">{play.team_tricode ? <TeamLogo abbr={play.team_tricode} size="xs" /> : null}</span>
                  <span className={cn('text-[13.5px] leading-snug', scoring ? 'font-medium text-text' : 'text-mute')}>{play.description}</span>
                  <span
                    className={cn('pt-px font-mono text-[12px] tabular-nums', scoring ? 'text-text' : 'text-dim')}
                    aria-label={`${lacAbbr} ${lacScore}, ${oppAbbr} ${oppScore}`}
                  >
                    {lacScore}–{oppScore}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
        {rows.length > SHOWN && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="mt-1 w-full rounded-[10px] px-3 py-2 text-left font-mono text-[11.5px] text-mute hover:bg-white/[0.03] hover:text-text"
          >
            {expanded ? 'Show fewer plays' : `Show all ${rows.length} plays`}
          </button>
        )}
      </Panel>
    </div>
  )
}
