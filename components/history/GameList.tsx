import Link from 'next/link'
import { Panel } from '@/components/ui/panel'
import { TeamLogo } from '@/components/ui/team-mark'
import { ResultBadge, Chip } from '@/components/ui/chip'
import { groupByMonth } from '@/src/lib/ui/schedule'
import { formatDay } from '@/src/lib/ui/time'
import { teamName } from '@/src/lib/ui/teams'
import { formatSigned } from '@/src/lib/ui/odds'
import type { HistoryGame, PlayedGame } from '@/src/lib/ui/season'

function Row({ g }: { g: PlayedGame }) {
  return (
    <li>
      <Link
        href={`/history/${g.game_id}`}
        className="row-hover grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-3 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)_80px_130px_56px] sm:gap-4"
      >
        <span className="hidden font-mono text-[12px] text-mute sm:block">{formatDay(g.game_date)}</span>
        <span className="flex min-w-0 items-center gap-3">
          <TeamLogo abbr={g.opponent_abbr} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-[14.5px] font-medium">
              <span className="text-mute">{g.home_away === 'home' ? 'vs' : '@'}</span> {teamName(g.opponent_abbr)}
            </span>
            <span className="block font-mono text-[11px] text-dim sm:hidden">{formatDay(g.game_date)}</span>
          </span>
        </span>
        <span className="hidden font-mono text-[11.5px] text-dim sm:block">{g.home_away === 'home' ? 'Home' : 'Away'}</span>
        <span className="flex items-center justify-end gap-2.5 sm:justify-start">
          <ResultBadge result={g.result} />
          <span className="text-[15px] font-semibold tabular-nums">
            {g.final_score.team}–{g.final_score.opp}
          </span>
          {g.ot && <Chip>OT</Chip>}
        </span>
        <span className={`hidden text-right font-mono text-[12px] tabular-nums sm:block ${g.margin > 0 ? 'text-pos' : 'text-neg'}`}>
          {formatSigned(g.margin)}
        </span>
      </Link>
    </li>
  )
}

/** Played games grouped by month (newest first), with unplayed games tucked away at the end. */
export function GameList({ played, upcoming }: { played: PlayedGame[]; upcoming: HistoryGame[] }) {
  const months = groupByMonth([...played].reverse())
  return (
    <div className="grid gap-6">
      {months.map((m) => {
        const w = m.games.filter((g) => g.result === 'W').length
        return (
          <section key={m.key}>
            <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
              <h2 className="m-0 text-[18px] font-semibold tracking-[-0.02em]">{m.label}</h2>
              <span className="font-mono text-[11.5px] text-dim tabular-nums">
                {w}–{m.games.length - w}
              </span>
            </div>
            <Panel className="p-1.5">
              <ol className="m-0 list-none p-0">
                {m.games.map((g) => (
                  <Row key={g.game_id} g={g} />
                ))}
              </ol>
            </Panel>
          </section>
        )
      })}
      {upcoming.length > 0 && (
        <details className="panel group p-1.5">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-[14px] px-3.5 py-3 text-[14.5px] font-medium [&::-webkit-details-marker]:hidden">
            Remaining · {upcoming.length} game{upcoming.length === 1 ? '' : 's'}
            <span className="font-mono text-[11.5px] text-dim group-open:hidden">Show</span>
            <span className="hidden font-mono text-[11.5px] text-dim group-open:inline">Hide</span>
          </summary>
          <ol className="m-0 list-none p-0">
            {upcoming.map((g) => (
              <li key={g.game_id} className="flex items-center gap-3 px-3.5 py-2 text-[14px] text-mute">
                <span className="w-[92px] font-mono text-[12px]">{formatDay(g.game_date)}</span>
                <TeamLogo abbr={g.opponent_abbr} size="xs" />
                {g.home_away === 'home' ? 'vs' : '@'} {teamName(g.opponent_abbr)}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}
