import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { PersonName } from './bits'
import { seasonLabel } from '@/src/lib/franchise/display'
import type { FranchisePersonRef, HonorRow, HonorsPayload } from '@/src/lib/ui/types'

/** Season awards that read heavier than an All-Star nod. */
const MAJOR = /^(mvp|roy|smoy|dpoy|mip|coy|finals_mvp|all_nba)/

function LeagueRetired({ rows }: { rows: HonorRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="mt-3 grid gap-1.5">
      {rows.map((h) => (
        <p key={`${h.person.person_key}-${h.detail}`} className="m-0 flex items-center gap-2 font-mono text-[11.5px] text-dim">
          <span className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-[6px] border border-line-2 px-1 text-mute">
            {h.detail?.replace(/^No\.\s*/, '') ?? '—'}
          </span>
          {h.detail ?? 'A number'} is retired league-wide for {h.person.name}.
        </p>
      ))}
    </div>
  )
}

/** Retired numbers first. The Clippers have none of their own; league-wide retirements are a quiet footnote. */
export function RetiredNumbers({ own, league }: { own: HonorRow[]; league: HonorRow[] }) {
  if (own.length > 0) {
    return (
      <Panel className="px-[18px] py-[22px] sm:px-7 sm:py-[26px]">
        <div className="flex flex-wrap gap-3">
          {own.map((h) => (
            <div key={`${h.person.person_key}-${h.detail}`} className="panel-inset flex items-center gap-3.5 rounded-[14px] px-4 py-3">
              <span className="text-[28px] font-semibold tracking-[-0.04em]">{h.detail?.replace(/^No\.\s*/, '') ?? '—'}</span>
              <PersonName person={h.person} className="text-[15px] font-medium" />
            </div>
          ))}
        </div>
        <LeagueRetired rows={league} />
      </Panel>
    )
  }
  return (
    <Panel className="grid items-center gap-3.5 px-[18px] py-[22px] sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-[22px] sm:px-7 sm:py-[26px]">
      <span
        aria-hidden
        className="grid h-[58px] w-12 place-items-center rounded-[10px_10px_4px_4px] border border-dashed border-line-2 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] text-[20px] font-semibold tracking-[-0.04em] text-mute/35 sm:h-[76px] sm:w-16 sm:text-[26px]"
      >
        —
      </span>
      <div>
        <p className="m-0 text-[17px] font-medium tracking-[-0.015em]">The Clippers haven&apos;t retired a number of their own.</p>
        <p className="m-0 mt-1 max-w-[60ch] text-[14px] text-mute">When they do, it will show here first.</p>
        <LeagueRetired rows={league} />
      </div>
    </Panel>
  )
}

/** Hall of Famers who played or coached for the franchise, with their induction year. */
export function HallOfFame({ rows }: { rows: HonorRow[] }) {
  return (
    <Panel className="p-2">
      {rows.map((h) => (
        <div key={h.person.person_key} className="row-hover grid grid-cols-[36px_minmax(0,1fr)] items-center gap-3 rounded-[14px] px-3 py-[9px]">
          <PlayerAvatar name={h.person.name} size={36} />
          <div className="min-w-0">
            <PersonName person={h.person} className="block truncate text-[14.5px] font-medium tracking-[-0.01em]" />
            <div className="mt-px font-mono text-[11px] text-dim">{h.detail ? `Inducted ${h.detail}` : 'Induction year not recorded'}</div>
          </div>
        </div>
      ))}
    </Panel>
  )
}

function Person({ person }: { person: FranchisePersonRef }) {
  return (
    <span className="inline-flex items-center gap-2 text-[14px]">
      <PlayerAvatar name={person.name} size={26} />
      <PersonName person={person} />
    </span>
  )
}

const RECENT = 8

function SeasonAwards({ s }: { s: HonorsPayload['awards_by_season'][number] }) {
  const awards = new Map<string, HonorRow[]>()
  for (const h of s.honors) awards.set(h.label, [...(awards.get(h.label) ?? []), h])
  const rows = [...awards.entries()].sort(([, a], [, b]) => Number(MAJOR.test(b[0].honor)) - Number(MAJOR.test(a[0].honor)))
  return (
    <div className="grid gap-y-1 px-3.5 py-3.5 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-x-4 sm:px-5 [&+&]:border-t [&+&]:border-line">
      <span className="font-mono text-[12px] text-mute sm:pt-[9px]">{seasonLabel(s.season_id)}</span>
      <div className="grid gap-0.5">
        {rows.map(([label, hs]) => {
          const details = [...new Set(hs.map((h) => h.detail).filter((d): d is string => !!d))]
          return (
            <div
              key={label}
              className="row-hover -mx-2.5 grid min-h-10 items-center gap-1.5 rounded-[12px] px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3 sm:py-1.5"
            >
              <span className={cn('text-[14px] text-text', MAJOR.test(hs[0].honor) && 'font-medium')}>
                {label}
                {details.length > 0 && <small className="mt-px block font-mono text-[10.5px] text-dim">{details.join(' · ')}</small>}
              </span>
              <span className="flex flex-wrap gap-x-3 gap-y-1.5 sm:justify-end">
                {hs.map((h) => (
                  <Person key={h.person.person_key} person={h.person} />
                ))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Awards and All-Star selections by season, newest first; one row per award, linked to players. Older seasons fold away. */
export function AwardsBySeason({ seasons }: { seasons: HonorsPayload['awards_by_season'] }) {
  const recent = seasons.slice(0, RECENT)
  const earlier = seasons.slice(RECENT)
  return (
    <Panel className="py-1">
      {recent.map((s) => (
        <SeasonAwards key={s.season_id} s={s} />
      ))}
      {earlier.length > 0 && (
        <details className="group border-t border-line">
          <summary className="glass-track press mx-3.5 my-3 flex cursor-pointer list-none items-center justify-between gap-3 rounded-[14px] px-3.5 py-3 text-[14px] text-mute transition-colors hover:text-text group-open:hidden sm:mx-5 [&::-webkit-details-marker]:hidden">
            Earlier seasons
            <span className="font-mono text-[11.5px] text-dim">
              {seasonLabel(earlier.at(-1)!.season_id)} to {seasonLabel(earlier[0].season_id)}
            </span>
          </summary>
          {earlier.map((s) => (
            <SeasonAwards key={s.season_id} s={s} />
          ))}
        </details>
      )}
    </Panel>
  )
}
