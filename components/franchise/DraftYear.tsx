import Link from 'next/link'
import { cn } from '@/lib/utils'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { TeamLogo } from '@/components/ui/team-mark'
import { PersonName, RoundBadge, plink } from './bits'
import { LotteryLine } from './LotteryLine'
import { monthYear } from '@/src/lib/franchise/display'
import type { DraftPick, FranchiseTeamRef } from '@/src/lib/ui/types'

function Team({ team }: { team: FranchiseTeamRef }) {
  return (
    <span className="inline-flex items-center gap-1 text-mute">
      <TeamLogo abbr={team.abbreviation} size="xs" />
      {team.abbreviation ?? '—'}
    </span>
  )
}

const ROW = 'row-hover -mx-2.5 grid grid-cols-[62px_32px_minmax(0,1fr)] items-center gap-2.5 rounded-[14px] px-2.5 py-2 sm:grid-cols-[74px_36px_minmax(0,1fr)] sm:gap-3'

const badge = (p: DraftPick) => (p.overall_pick != null ? `R${p.round} · ${p.overall_pick}` : `R${p.round}`)

/** A pick the Clippers used: player (linked when they have a page) and "from X via Y". */
function UsedPick({ pick }: { pick: DraftPick }) {
  const own = pick.original_team.is_clippers
  const via = pick.via.filter((t) => !t.is_clippers)
  const inbound = [...pick.chain].reverse().find((h) => h.to?.is_clippers && h.href)
  return (
    <div className={ROW}>
      <RoundBadge>{badge(pick)}</RoundBadge>
      {pick.player ? (
        <PlayerAvatar name={pick.player.name} size={36} className="max-sm:!h-8 max-sm:!w-8" />
      ) : (
        <span aria-hidden className="h-8 w-8 rounded-full border border-dashed border-line-2 sm:h-9 sm:w-9" />
      )}
      <div className="min-w-0">
        <div className="truncate text-[15px] font-medium tracking-[-0.01em]">
          {pick.player ? <PersonName person={pick.player} /> : <span className="font-normal text-dim">Player not recorded</span>}
        </div>
        <div className="mt-[3px] flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[11px] text-dim">
          {own ? (
            <span>Own pick</span>
          ) : (
            <>
              from <Team team={pick.original_team} />
              {via.map((t) => (
                <span key={t.franchise_id} className="inline-flex items-center gap-1.5">
                  via <Team team={t} />
                </span>
              ))}
            </>
          )}
          {inbound && (
            <>
              <span aria-hidden>·</span>
              <Link href={inbound.href!} prefetch={false} className={cn('text-mute', plink)}>
                acquired {monthYear(inbound.date)}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** A pick the Clippers owned but traded before the draft: dimmed, with where it went and what it became. */
function TradedPick({ pick }: { pick: DraftPick }) {
  const out = [...pick.chain].reverse().find((h) => h.from?.is_clippers)
  const owner = pick.owner
  return (
    <div className={cn(ROW, 'opacity-55 transition-opacity duration-300 hover:opacity-85')}>
      <RoundBadge>{`R${pick.round}`}</RoundBadge>
      <span className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-line-2 sm:h-9 sm:w-9">
        {owner && <TeamLogo abbr={owner.abbreviation} size="xs" />}
      </span>
      <div className="min-w-0">
        <div className="text-[15px] tracking-[-0.01em] text-mute">
          {owner ? `Traded to ${owner.abbreviation ?? owner.name ?? 'another team'}` : 'Traded away'}
          {pick.overall_pick != null && (
            <>
              {' · became '}
              <b className="font-medium text-text">No. {pick.overall_pick}</b>
            </>
          )}
          {pick.player && <>, {pick.player.name}</>}
        </div>
        <div className="mt-[3px] flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[11px] text-dim">
          {!pick.original_team.is_clippers && (
            <>
              <Team team={pick.original_team} /> pick <span aria-hidden>·</span>
            </>
          )}
          {out?.href ? (
            <>
              in a{' '}
              <Link href={out.href} prefetch={false} className={cn('text-mute', plink)}>
                trade with {out.to?.abbreviation ?? 'another team'}
              </Link>
              <span aria-hidden>·</span> {monthYear(out.date)}
            </>
          ) : (
            <span>trade not recorded</span>
          )}
        </div>
      </div>
    </div>
  )
}

/** One draft year: the year column, then its picks (with a lottery line under any pick that had one). */
export function DraftYear({ year, picks }: { year: number; picks: DraftPick[] }) {
  const away = picks.filter((p) => p.traded_away).length
  const used = picks.length - away
  const meta = [used ? `${used} pick${used === 1 ? '' : 's'}` : null, away ? (used ? `${away} traded` : `${away} traded away`) : null].filter(Boolean).join(' · ')
  return (
    <section className="grid gap-y-2 px-3.5 py-4 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-x-5 sm:px-5 sm:py-[18px] [&+&]:border-t [&+&]:border-line" aria-label={`${year} draft`}>
      <div className="flex items-baseline gap-2.5 sm:block">
        <h2 className="m-0 text-[20px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[22px]">{year}</h2>
        <p className="m-0 font-mono text-[11px] text-dim sm:mt-1">{meta}</p>
      </div>
      <div className="grid min-w-0 gap-1">
        {picks.map((p) => (
          <div key={p.pick_key}>
            {p.traded_away ? <TradedPick pick={p} /> : <UsedPick pick={p} />}
            {p.lottery && <LotteryLine lottery={p.lottery} />}
          </div>
        ))}
      </div>
    </section>
  )
}
