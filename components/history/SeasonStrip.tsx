import Link from 'next/link'
import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { formatSigned } from '@/src/lib/ui/odds'
import { formatDayShort } from '@/src/lib/ui/time'
import type { PlayedGame } from '@/src/lib/ui/season'

/**
 * Every played game as a thin bar in date order: wins above the line, losses
 * below, height by margin. Hover for the result; click to open the game.
 */
export function SeasonStrip({ games, streaks }: { games: PlayedGame[]; streaks: { longestWin: number; longestLoss: number; current: { kind: 'W' | 'L'; length: number } | null } }) {
  if (games.length === 0) return null
  const max = Math.max(10, ...games.map((g) => Math.abs(g.margin)))
  const months: Array<{ label: string; index: number }> = []
  games.forEach((g, i) => {
    const m = g.game_date.slice(0, 7)
    if (i === 0 || games[i - 1].game_date.slice(0, 7) !== m) {
      months.push({ label: new Date(`${g.game_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), index: i })
    }
  })

  return (
    <Panel className="p-5 sm:p-6">
      <Eyebrow as="h2" aside={`${games.length} games`}>
        Season results
      </Eyebrow>
      <div className="overflow-x-auto no-scrollbar">
        <div className="min-w-[560px]">
          <ol className="relative m-0 flex h-[120px] list-none items-stretch gap-[2px] p-0">
            <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
            {games.map((g) => {
              const h = Math.max(6, (Math.abs(g.margin) / max) * 50)
              const win = g.result === 'W'
              const label = `${win ? 'W' : 'L'} ${g.final_score.team}–${g.final_score.opp} ${g.home_away === 'home' ? 'vs' : '@'} ${g.opponent_abbr} · ${formatDayShort(g.game_date)}${g.ot ? ' · OT' : ''}`
              return (
                <li key={g.game_id} className="relative flex-1">
                  <Link href={`/history/${g.game_id}`} title={label} aria-label={label} className="group absolute inset-0">
                    <span
                      className={`absolute left-0 right-0 rounded-[2px] transition-[filter,opacity] duration-200 group-hover:brightness-150 ${win ? 'bottom-1/2 bg-pos/80' : 'top-1/2 bg-neg/80'}`}
                      style={{ height: `${h}%` }}
                    />
                  </Link>
                </li>
              )
            })}
          </ol>
          <div className="relative mt-2 h-4">
            {months.map((m) => (
              <span
                key={`${m.label}-${m.index}`}
                className="absolute font-mono text-[10.5px] uppercase tracking-[0.1em] text-dim"
                style={{ left: `${(m.index / games.length) * 100}%` }}
              >
                {m.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11.5px] text-mute">
        <span>
          Longest win streak <span className="text-pos">{streaks.longestWin}</span>
        </span>
        <span>
          Longest losing streak <span className="text-neg">{streaks.longestLoss}</span>
        </span>
        {streaks.current && streaks.current.length >= 2 && (
          <span>
            Latest{' '}
            <span className={streaks.current.kind === 'W' ? 'text-pos' : 'text-neg'}>
              {streaks.current.length}-game {streaks.current.kind === 'W' ? 'win' : 'losing'} streak
            </span>
          </span>
        )}
        <span className="text-dim">Avg margin {formatSigned(games.reduce((s, g) => s + g.margin, 0) / games.length, 1)}</span>
      </div>
    </Panel>
  )
}
