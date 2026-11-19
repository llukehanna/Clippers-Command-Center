'use client'

import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { TeamLogo } from '@/components/ui/team-mark'
import { Chip, ResultBadge } from '@/components/ui/chip'
import { Segmented } from '@/components/ui/segmented'
import { Stat } from '@/components/ui/stat'
import { positionLabel } from './RosterGrid'
import { formatDayShort } from '@/src/lib/ui/time'
import { seasonShort } from '@/src/lib/ui/season'
import type { CareerHigh, CareerSeason, PlayerCareerPayload } from '@/src/lib/data/player-career'

const one = (v: number | null) => (v == null ? '—' : v.toFixed(1))
const pct = (v: number | null) => (v == null ? '—' : (v * 100).toFixed(1))

/** Hero for a former player: Clippers-jersey photo, years, career averages and totals. */
export function CareerHero({ name, position, career }: { name: string; position: string | null; career: PlayerCareerPayload }) {
  const line = career.regular
  const seasons = new Set([...career.seasons.regular, ...career.seasons.playoffs].map((s) => s.season_id)).size
  const span = career.first_season != null && career.last_season != null ? `${seasonShort(career.first_season)} to ${seasonShort(career.last_season)}` : ''
  return (
    <Panel variant="hero" className="grid grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
      <div className="relative">
        <PlayerAvatar name={name} nbaPlayerId={career.nba_person_id} clippersSeason={career.last_season} variant="hero" priority className="h-full min-h-[230px]" />
        <TeamLogo abbr="LAC" size="md" className="absolute left-4 top-4 opacity-90" />
      </div>
      <div className="relative flex flex-col justify-between gap-6 p-5 sm:p-7">
        <div>
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="blue">Former Clippers</Chip>
            {career.points_rank != null && <Chip>#{career.points_rank} in franchise points</Chip>}
          </div>
          <p className="label-mono mt-5 !text-mute">
            {positionLabel(position)} · {span}
          </p>
          <h1 className="m-0 mt-2 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[44px]">{name}</h1>
          <p className="m-0 mt-2 font-mono text-[12px] text-mute">
            {line ? `${line.games} games · ` : ''}
            {seasons} season{seasons === 1 ? '' : 's'} with the Clippers · regular season
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          <Stat size="lg" label="Points" value={one(line?.pts_avg ?? null)} sub={line ? `${line.pts_total.toLocaleString()} total` : undefined} />
          <Stat size="lg" label="Rebounds" value={one(line?.reb_avg ?? null)} sub={line ? `${line.reb_total.toLocaleString()} total` : undefined} />
          <Stat size="lg" label="Assists" value={one(line?.ast_avg ?? null)} sub={line ? `${line.ast_total.toLocaleString()} total` : undefined} />
          <Stat size="lg" label="True shooting" value={pct(line?.ts_pct ?? null)} sub="Clippers career" />
        </div>
      </div>
    </Panel>
  )
}

/**
 * Season-by-season Clippers lines with a bar per season. Choosing a season
 * (bar or row) re-scopes the trend chart, splits and game log below to it.
 */
export function CareerSeasons({ playerId, career, selected }: { playerId: string; career: PlayerCareerPayload; selected: number | null }) {
  const hasPlayoffs = career.seasons.playoffs.length > 0
  const [kind, setKind] = React.useState<'regular' | 'playoffs'>('regular')
  const rows: CareerSeason[] = career.seasons[kind]
  const max = Math.max(1, ...rows.map((r) => r.pts_avg ?? 0))
  const href = (s: number) => `/players/${playerId}?season=${s}`

  return (
    <Panel className="overflow-hidden pt-4">
      <div className="mb-3 flex items-center gap-2.5 px-5">
        <h2 className="m-0 font-mono text-[11.5px] font-normal uppercase leading-none tracking-[0.14em] text-mute">Season by season</h2>
        <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-line-2 to-transparent" />
        {hasPlayoffs && (
          <Segmented
            ariaLabel="Season type"
            size="sm"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'regular', label: 'Regular' },
              { value: 'playoffs', label: 'Playoffs' },
            ]}
          />
        )}
      </div>

      {rows.length > 1 && (
        <div className="px-5" aria-hidden>
          <div className="flex h-[110px] items-end gap-1.5">
            {rows.map((r) => (
              <Link
                key={r.season_id}
                href={href(r.season_id)}
                scroll={false}
                tabIndex={-1}
                title={`${seasonShort(r.season_id)} · ${one(r.pts_avg)} PPG`}
                className={cn(
                  'flex-1 rounded-t-[6px] rounded-b-[2px] transition-[filter,background] duration-300 hover:brightness-125',
                  r.season_id === selected
                    ? 'bg-gradient-to-b from-[#7fb6ec] to-pacific shadow-[0_0_18px_-4px_rgba(65,143,222,0.8)]'
                    : 'bg-gradient-to-b from-pacific/90 to-pacific/35',
                )}
                style={{ height: `${Math.max(4, ((r.pts_avg ?? 0) / max) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex gap-1.5 pb-2">
            {rows.map((r) => (
              <span key={r.season_id} className="flex-1 text-center font-mono text-[10.5px] text-dim">
                {String(r.season_id + 1).slice(2)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[13.5px] tabular-nums">
          <thead>
            <tr className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim">
              <th className="px-2.5 pb-2 pl-5 pt-3 text-left font-normal">Season</th>
              <th className="px-2.5 pb-2 pt-3 text-right font-normal">GP</th>
              <th className="px-2.5 pb-2 pt-3 text-right font-normal">PPG</th>
              <th className="px-2.5 pb-2 pt-3 text-right font-normal">RPG</th>
              <th className="px-2.5 pb-2 pt-3 text-right font-normal">APG</th>
              <th className="px-2.5 pb-2 pr-5 pt-3 text-right font-normal">TS%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const on = r.season_id === selected
              const cell = 'border-t border-line px-2.5 py-0'
              const link = 'block py-2.5'
              return (
                <tr key={r.season_id} className={cn('row-hover', on && 'bg-pacific/[0.1]')}>
                  <td className={cn(cell, 'pl-5', on && 'shadow-[inset_3px_0_0_var(--pacific)]')}>
                    <Link href={href(r.season_id)} scroll={false} aria-current={on ? 'true' : undefined} className={cn(link, 'font-mono text-[12.5px]', on ? 'text-white' : 'text-text')}>
                      {seasonShort(r.season_id)}
                    </Link>
                  </td>
                  <td className={cn(cell, 'text-right')}>
                    <Link href={href(r.season_id)} scroll={false} tabIndex={-1} className={link}>
                      {r.games}
                    </Link>
                  </td>
                  <td className={cn(cell, 'text-right font-semibold')}>
                    <Link href={href(r.season_id)} scroll={false} tabIndex={-1} className={link}>
                      {one(r.pts_avg)}
                    </Link>
                  </td>
                  <td className={cn(cell, 'text-right')}>
                    <Link href={href(r.season_id)} scroll={false} tabIndex={-1} className={link}>
                      {one(r.reb_avg)}
                    </Link>
                  </td>
                  <td className={cn(cell, 'text-right')}>
                    <Link href={href(r.season_id)} scroll={false} tabIndex={-1} className={link}>
                      {one(r.ast_avg)}
                    </Link>
                  </td>
                  <td className={cn(cell, 'pr-5 text-right text-mute')}>
                    <Link href={href(r.season_id)} scroll={false} tabIndex={-1} className={link}>
                      {pct(r.ts_pct)}
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/** Top scoring games for the Clippers. */
export function CareerHighs({ highs }: { highs: CareerHigh[] }) {
  if (highs.length === 0) return null
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center gap-2.5 px-[18px] pb-1 pt-4">
        <h2 className="m-0 font-mono text-[11.5px] font-normal uppercase leading-none tracking-[0.14em] text-mute">Clippers career highs</h2>
        <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-line-2 to-transparent" />
      </div>
      <ol className="m-0 list-none p-0">
        {highs.map((h) => {
          const result = h.team_score != null && h.opp_score != null ? (h.team_score > h.opp_score ? 'W' : 'L') : null
          return (
            <li key={h.game_id} className="border-t border-line first:border-t-0">
              <Link href={`/history/${h.game_id}`} prefetch={false} className="row-hover flex items-center gap-4 px-[18px] py-3">
                <span className="w-[52px] text-[26px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{h.points}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[14px]">
                    <span className="text-mute">{h.home ? 'vs' : '@'}</span>
                    <TeamLogo abbr={h.opp} size="xs" />
                    <span className="font-medium">{h.opp}</span>
                    {h.playoffs && <Chip tone="blue">Playoffs</Chip>}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[11.5px] text-mute">
                    {formatDayShort(h.game_date)}, {h.game_date.slice(0, 4)} · {h.rebounds ?? 0} reb · {h.assists ?? 0} ast
                  </span>
                </span>
                {result && (
                  <span className="flex shrink-0 items-center gap-2">
                    <ResultBadge result={result} />
                    <span className="font-mono text-[12px] text-mute tabular-nums">
                      {h.team_score}–{h.opp_score}
                    </span>
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}
