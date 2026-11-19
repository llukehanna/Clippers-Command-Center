import Link from 'next/link'
import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { ResultBadge } from '@/components/ui/chip'
import { TeamLogo } from '@/components/ui/team-mark'
import { formatDayShort } from '@/src/lib/ui/time'
import { formatSigned } from '@/src/lib/ui/odds'
import { ordinal } from '@/src/lib/record-notes'
import type { GamePreviewPayload, PreviewRank, PreviewTeamForm } from '@/src/lib/ui/types'

const rec = (r: { wins: number; losses: number } | null) => (r ? `${r.wins}-${r.losses}` : '—')
const rank = (r: PreviewRank | undefined) => (r ? `${ordinal(r.rank)} (${r.value})` : '—')
const rest = (d: number | null) => (d == null ? '—' : d === 1 ? 'Back-to-back' : `${d - 1} day${d - 1 === 1 ? '' : 's'} rest`)

const ROWS: Array<[string, (f: PreviewTeamForm) => string]> = [
  ['Record', (f) => rec(f.record)],
  ['Last 10', (f) => (f.last10 ? `${f.last10.wins}-${f.last10.losses}` : '—')],
  ['Net rtg, last 10', (f) => (f.last10?.net_rating == null ? '—' : formatSigned(f.last10.net_rating, 1))],
  ['Offense', (f) => rank(f.ranks?.off)],
  ['Defense', (f) => rank(f.ranks?.def)],
  ['Net rtg', (f) => rank(f.ranks?.net)],
  ['Rest', (f) => rest(f.days_since_last)],
]

export function Matchup({ matchup, oppAbbr }: { matchup: GamePreviewPayload['matchup']; oppAbbr: string }) {
  const { meetings, season_series } = matchup
  return (
    <section aria-label="Matchup" className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Panel className="p-5">
        <Eyebrow>Form</Eyebrow>
        <table className="w-full border-collapse text-[13.5px] tabular-nums">
          <thead>
            <tr className="text-left font-mono text-[11px] uppercase tracking-[0.1em] text-dim">
              <th className="pb-2 font-normal" />
              <th className="pb-2 text-right font-normal"><span className="inline-flex items-center gap-1.5"><TeamLogo abbr="LAC" size="xs" />LAC</span></th>
              <th className="pb-2 text-right font-normal"><span className="inline-flex items-center gap-1.5"><TeamLogo abbr={oppAbbr} size="xs" />{oppAbbr}</span></th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, get]) => (
              <tr key={label} className="border-t border-line">
                <td className="py-2 text-mute">{label}</td>
                <td className="py-2 text-right">{get(matchup.lac)}</td>
                <td className="py-2 text-right">{get(matchup.opp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {meetings && (
        <Panel className="p-5">
          <Eyebrow aside={season_series && season_series.wins + season_series.losses > 0 ? `Season series ${season_series.wins}-${season_series.losses}` : undefined}>
            Last meetings
          </Eyebrow>
          {meetings.length ? (
            <ul className="m-0 grid list-none gap-1 p-0">
              {meetings.map((m) => (
                <li key={m.game_id}>
                  <Link href={`/history/${m.game_id}`} className="flex items-center justify-between gap-3 rounded-[10px] px-2 py-2 text-[13.5px] transition-colors hover:bg-ink-2/60">
                    <span className="font-mono text-[12px] text-mute">{formatDayShort(m.game_date)}</span>
                    <span className="flex items-center gap-2 tabular-nums">
                      {m.lac_home ? 'vs' : '@'} {oppAbbr} {m.lac_score}-{m.opp_score}
                      <ResultBadge result={m.won ? 'W' : 'L'} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13.5px] text-mute">First meeting in the database.</p>
          )}
        </Panel>
      )}
    </section>
  )
}
