'use client'

import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { TeamLogo } from '@/components/ui/team-mark'
import { plink } from './bits'
import { highlightNames, moveDate } from '@/src/lib/franchise/display'
import { teamFullName } from '@/src/lib/franchise/franchise-ids'
import type { RootRow, TreeGroup } from '@/src/lib/franchise/trade-display'
import type { TreeNode } from '@/src/lib/ui/types'

const tradeHref = (slug: string) => `/franchise/trades/${slug}`
const expandable = (n: TreeNode) => n.children.length > 0 || n.truncatedAt != null

/** Paths ("g0.1.0") of every row that can open, for "Expand all". */
function allPaths(groups: TreeGroup[]): string[] {
  const out: string[] = []
  const walk = (n: TreeNode, path: string) => {
    if (expandable(n)) out.push(path)
    n.children.forEach((c, i) => walk(c, `${path}.${i}`))
  }
  groups.forEach((g) => g.rows.forEach((r, i) => walk(r.node, `${g.key}:${i}`)))
  return out
}

/** Top-level rows start open (spec: the first step of every asset is visible). */
function topPaths(groups: TreeGroup[]): string[] {
  return groups.flatMap((g) => g.rows.flatMap((r, i) => (expandable(r.node) ? [`${g.key}:${i}`] : [])))
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('grid h-[18px] w-[18px] place-items-center text-mute motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-premium', open && 'rotate-90')}
    >
      <svg width="10" height="10" viewBox="0 0 10 10">
        <path d="M3.5 2 6.5 5 3.5 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function Leaf() {
  return (
    <span aria-hidden className="grid h-[18px] w-[18px] place-items-center">
      <span className="h-[5px] w-[5px] rounded-full bg-line-2" />
    </span>
  )
}

function RootMark({ row }: { row: RootRow }) {
  const { node } = row
  if (row.glyph === 'person' && node.person) return <PlayerAvatar name={node.person.name} nbaPlayerId={node.person.nba_person_id} size={26} />
  if (row.glyph === 'pick' && row.logo) return <TeamLogo abbr={row.logo} size="xs" />
  const glyph = row.glyph === 'swap' ? '⇄' : row.glyph === 'cash' ? '$' : row.glyph === 'pick' ? '?' : '·'
  return (
    <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-dashed border-line-2 font-mono text-[10px] text-dim">
      {glyph}
    </span>
  )
}

/** A step's mark: the drafted player's face when the row introduces a new person, else the team holding the asset. */
function StepMark({ node, parentPerson }: { node: TreeNode; parentPerson: string | null }) {
  if (node.person && node.person.person_key !== parentPerson) return <PlayerAvatar name={node.person.name} nbaPlayerId={node.person.nba_person_id} size={24} />
  if (node.team) return <TeamLogo abbr={node.team.abbreviation} size="xs" />
  return null
}

/** Step text with the team and person it names in bright type; the person links only on rows that aren't toggles. */
function StepLabel({ node, linkPerson }: { node: TreeNode; linkPerson: boolean }) {
  const names = [node.team ? teamFullName(node.team) : null, node.person?.name ?? null].filter((n): n is string => !!n)
  return (
    <>
      {highlightNames(node.label, names).map((s, i) => {
        if (!s.name) return <span key={i}>{s.text}</span>
        if (linkPerson && node.person?.href && s.name === node.person.name) {
          return (
            <Link key={i} href={node.person.href} prefetch={false} className={cn('text-text', plink)}>
              {s.text}
            </Link>
          )
        }
        return (
          <b key={i} className="font-normal text-text">
            {s.text}
          </b>
        )
      })}
    </>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <span className="mt-0.5 block font-mono text-[11px] leading-[1.4] text-dim">{children}</span>
}

interface RowProps {
  node: TreeNode
  path: string
  depth: number
  root?: RootRow
  parentPerson: string | null
  open: Set<string>
  toggle: (path: string) => void
}

const ROW = 'row-hover grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-[12px] sm:grid-cols-[minmax(0,1fr)_auto_auto]'
const MAIN = 'grid min-h-[42px] w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5 px-1.5 py-2 text-left sm:px-2.5'
const WHEN = 'col-span-full -mt-2 whitespace-nowrap pb-2 pl-[34px] font-mono text-[11px] text-dim sm:col-span-1 sm:mt-0 sm:pb-0 sm:pl-0 sm:pr-2.5 sm:text-right'

function Row({ node, path, depth, root, parentPerson, open, toggle }: RowProps) {
  const id = React.useId()
  const canOpen = expandable(node)
  const isOpen = canOpen && open.has(path)
  const tradeLink = depth > 0 && node.href?.startsWith('/franchise/trades/') ? node.href : null
  const person = node.person?.person_key ?? parentPerson

  const body = (
    <span className={cn('flex min-w-0 items-center gap-2.5', depth === 0 ? 'text-[15px] font-medium text-text' : 'text-[14px] text-mute')}>
      {/* Marks are decorative here: the row's text already names the team or person. */}
      <span aria-hidden className="flex shrink-0 empty:hidden">
        {root ? <RootMark row={root} /> : <StepMark node={node} parentPerson={parentPerson} />}
      </span>
      <span className="min-w-0">
        {root ? (
          <>
            {!canOpen && node.person?.href ? (
              <Link href={node.person.href} prefetch={false} className={plink}>
                {root.title}
              </Link>
            ) : (
              root.title
            )}
            {root.meta && <span className="font-mono text-[11px] font-normal text-dim"> · {root.meta}</span>}
          </>
        ) : (
          <StepLabel node={node} linkPerson={!canOpen} />
        )}
        {node.note && <Note>{node.note}</Note>}
      </span>
    </span>
  )

  return (
    <li className="m-0 list-none">
      <div className={ROW}>
        {canOpen ? (
          <button type="button" aria-expanded={isOpen} aria-controls={id} onClick={() => toggle(path)} className={cn(MAIN, 'cursor-pointer rounded-[12px]')}>
            <Chevron open={isOpen} />
            {body}
          </button>
        ) : (
          <div className={MAIN}>
            <Leaf />
            {body}
          </div>
        )}
        <span className="pr-1.5 sm:pr-0">
          {tradeLink && (
            <Link href={tradeLink} prefetch={false} aria-label={`Trade page: ${node.label}`} className="whitespace-nowrap rounded-full px-1 py-1 font-mono text-[11.5px] text-[#9cc7f2] transition-colors hover:text-[#cfe3f8]">
              Trade<span className="max-sm:hidden"> page</span>
              <span aria-hidden> →</span>
            </Link>
          )}
        </span>
        {node.date ? <span className={WHEN}>{moveDate(node.date)}</span> : <span className="hidden sm:block" />}
      </div>

      {canOpen && (
        <div
          id={id}
          inert={!isOpen}
          className={cn('grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-300 motion-safe:ease-premium', isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}
        >
          <div className="min-h-0 overflow-hidden">
            <ul className="m-0 ml-[15px] border-l border-line-2 p-0 pl-1.5 sm:ml-[19px] sm:pl-3">
              {node.children.map((c, i) => (
                <Row key={i} node={c} path={`${path}.${i}`} depth={depth + 1} parentPerson={person} open={open} toggle={toggle} />
              ))}
              {node.truncatedAt && (
                <li className="m-0 list-none">
                  <Link href={tradeHref(node.truncatedAt)} prefetch={false} className={cn(MAIN, 'row-hover rounded-[12px] font-mono text-[12px] text-[#9cc7f2] hover:text-[#cfe3f8]')}>
                    <Leaf />
                    <span>
                      Continue on that trade&apos;s page<span aria-hidden> →</span>
                    </span>
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * "What it became": every asset of the trade as a row that expands into its next event
 * (up to three steps). Top-level rows start open; every toggle is a real button.
 */
export function TradeTree({ groups, depth = 3 }: { groups: TreeGroup[]; depth?: number }) {
  const every = React.useMemo(() => allPaths(groups), [groups])
  const [open, setOpen] = React.useState<Set<string>>(() => new Set(topPaths(groups)))
  const toggle = React.useCallback(
    (path: string) =>
      setOpen((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      }),
    [],
  )
  const allOpen = every.length > 0 && every.every((p) => open.has(p))

  return (
    <section aria-label="What it became">
      <Eyebrow
        aside={
          every.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen(new Set(allOpen ? [] : every))}
              className="rounded-full px-1 py-0.5 font-mono text-[11.5px] text-mute transition-colors hover:text-text"
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          ) : (
            `up to ${depth} steps`
          )
        }
      >
        What it became
      </Eyebrow>
      <Panel className="px-2 py-2 sm:px-3.5 sm:py-3">
        {groups.length === 0 && <p className="m-0 px-2.5 py-4 text-[14px] text-dim">No assets recorded for this trade.</p>}
        {groups.map((g, gi) => (
          <div key={g.key} className={cn('py-1.5', gi > 0 && 'mt-1.5 border-t border-line pt-3')}>
            <p className="label-mono m-0 flex items-center gap-2 px-1.5 pb-1.5 pt-1 sm:px-2.5">
              {g.team ? <TeamLogo abbr={g.team.abbreviation} size="xs" /> : null}
              {g.heading}
            </p>
            <ul className="m-0 grid gap-px p-0">
              {g.rows.map((r, i) => (
                <Row key={i} node={r.node} path={`${g.key}:${i}`} depth={0} root={r} parentPerson={null} open={open} toggle={toggle} />
              ))}
            </ul>
          </div>
        ))}
      </Panel>
      <p className="m-0 mt-2.5 px-1 font-mono text-[11px] text-dim">Each step follows the asset to its next recorded move, up to {depth} steps.</p>
    </section>
  )
}
