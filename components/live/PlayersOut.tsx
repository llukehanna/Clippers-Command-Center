import * as React from 'react'
import Link from 'next/link'
import { Chip, type ChipTone } from '@/components/ui/chip'
import { Panel } from '@/components/ui/panel'
import { TeamLogo } from '@/components/ui/team-mark'
import { playerHref } from '@/src/lib/ui/live'
import { formatDayShort } from '@/src/lib/ui/time'
import type { PlayerInjury } from '@/src/lib/types/live'

function statusTone(status: string): ChipTone {
  return /^out$/i.test(status) ? 'neg' : 'warn'
}

function Team({ abbr, players, linkPlayers }: { abbr: string; players: PlayerInjury[]; linkPlayers: boolean }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-mute">
        <TeamLogo abbr={abbr} size="xs" />
        {abbr}
      </div>
      {players.length === 0 ? (
        <p className="m-0 text-[13px] text-dim">Nobody listed.</p>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {players.map((p) => {
            const href = linkPlayers ? playerHref(p.personId) : null
            return (
              <li key={`${p.personId}-${p.name}`} className="grid gap-1 rounded-[12px] bg-white/[0.03] px-3 py-2">
                <span className="flex items-center justify-between gap-3">
                  {href ? (
                    <Link href={href} className="truncate text-[13.5px] font-medium hover:underline">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="truncate text-[13.5px] font-medium">{p.name}</span>
                  )}
                  <Chip tone={statusTone(p.status)}>{p.status}</Chip>
                </span>
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[12.5px] text-mute">
                  <span>{p.injury || 'Reason not given'}</span>
                  {p.returnDate && <span className="font-mono text-[11.5px] text-dim">Est. return {formatDayShort(p.returnDate)}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Each side's injury report: who's out, why, and when they're expected back. */
export function PlayersOut({ injuries, lacAbbr, oppAbbr }: { injuries: { lac: PlayerInjury[]; opp: PlayerInjury[] }; lacAbbr: string; oppAbbr: string }) {
  return (
    <Panel className="grid gap-5 p-4 sm:p-5">
      <Team abbr={lacAbbr} players={injuries.lac} linkPlayers />
      <Team abbr={oppAbbr} players={injuries.opp} linkPlayers={false} />
      <p className="m-0 font-mono text-[11px] text-dim">Return dates are ESPN&rsquo;s estimates.</p>
    </Panel>
  )
}
