import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Chip } from '@/components/ui/chip'
import { TeamLogo } from '@/components/ui/team-mark'
import { GapNote, plink } from './bits'
import { highlightNames, kindLabel, moveDate, teamPlace } from '@/src/lib/franchise/display'
import type { MoveRow as Move } from '@/src/lib/ui/types'

const GRID =
  'grid grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:"kind_date_teams"_"desc_desc_desc"] items-center gap-x-2.5 gap-y-2 rounded-[14px] p-3 ' +
  'md:grid-cols-[100px_92px_minmax(0,1fr)_auto_14px] md:[grid-template-areas:"date_kind_desc_teams_chev"] md:gap-x-4 md:px-3.5'

/** Description with the people it names in bright type; on non-trade rows, names with a page link to it. */
function Description({ move, linkNames }: { move: Move; linkNames: boolean }) {
  const byName = new Map(move.people.map((p) => [p.name, p]))
  const segments = highlightNames(move.description, move.people.map((p) => p.name))
  return (
    <span className="text-[14px] leading-[1.45] text-mute [grid-area:desc] md:text-[14.5px]">
      {segments.map((s, i) => {
        if (!s.name) return <span key={i}>{s.text}</span>
        const person = byName.get(s.name)
        if (linkNames && person?.href) {
          return (
            <Link key={i} href={person.href} prefetch={false} className={cn('font-medium text-text', plink)}>
              {s.text}
            </Link>
          )
        }
        return (
          <span key={i} className="font-medium text-text">
            {s.text}
          </span>
        )
      })}
      {!move.is_complete && <GapNote className="ml-2 align-[1px]">details pending</GapNote>}
    </span>
  )
}

/** One Clippers move: date, kind chip, our sentence, and the other teams' marks (era names). Trades open their page. */
export function MoveRow({ move }: { move: Move }) {
  const others = move.teams.filter((t) => !t.is_clippers)
  const isTrade = move.kind_group === 'trade' && move.href
  const body = (
    <>
      <span className="whitespace-nowrap font-mono text-[11.5px] text-mute [grid-area:date] md:text-[12px]">{moveDate(move.date)}</span>
      <span className="[grid-area:kind]">
        <Chip tone={move.kind_group === 'trade' ? 'blue' : 'default'}>{kindLabel(move.kind)}</Chip>
      </span>
      <Description move={move} linkNames={!isTrade} />
      <span className="flex items-center justify-end gap-1.5 [grid-area:teams]">
        {others.map((t) => (
          <span key={t.franchise_id} title={teamPlace(t)}>
            <TeamLogo abbr={t.abbreviation} size="sm" />
          </span>
        ))}
      </span>
      <span aria-hidden className="hidden text-dim transition-[color,transform] duration-300 ease-premium [grid-area:chev] group-hover:translate-x-0.5 group-hover:text-text md:block">
        {isTrade && (
          <svg width="12" height="12" viewBox="0 0 10 10">
            <path d="M3.5 2 6.5 5 3.5 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </>
  )
  return (
    <li>
      {isTrade ? (
        <Link href={move.href!} prefetch={false} className={cn('group row-hover', GRID)}>
          {body}
        </Link>
      ) : (
        <div className={cn('row-hover', GRID)}>{body}</div>
      )}
    </li>
  )
}
