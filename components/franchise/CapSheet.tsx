import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { TableScroll, Td, Th, Tr } from '@/components/ui/data-table'
import { PersonName } from './bits'
import { money, seasonLabel } from '@/src/lib/franchise/display'
import type { ContractSeason, ContractsPayload } from '@/src/lib/ui/types'

const OPTION: Record<NonNullable<ContractSeason['option']>, { label: string; title: string; legend: string; className: string }> = {
  player: { label: 'PO', title: 'Player option', legend: 'Player option', className: 'border-pacific/35 bg-pacific/[0.14] text-[#9cc7f2]' },
  team: { label: 'TO', title: 'Team option', legend: 'Team option', className: 'border-[rgba(150,178,230,0.22)] bg-white/[0.04] text-text' },
  early_termination: { label: 'ETO', title: 'Early termination option', legend: 'Early termination', className: 'border-warn/35 bg-warn/10 text-warn' },
}

function OptionTag({ option }: { option: NonNullable<ContractSeason['option']> }) {
  const o = OPTION[option]
  return (
    <span title={o.title} className={cn('inline-grid min-w-[26px] place-items-center rounded-[6px] border px-1 py-0.5 font-mono text-[9.5px] leading-[1.2] tracking-[0.06em]', o.className)}>
      {o.label}
    </span>
  )
}

const NG = 'text-mute underline decoration-dashed decoration-[rgba(141,152,174,0.7)] underline-offset-4'

/** One season's cell: option tag, amount (dashed when not fully guaranteed). A known-unknown amount is —. */
function Amount({ s }: { s: ContractSeason }) {
  const partly = s.amount_usd != null && s.guaranteed_usd != null && s.guaranteed_usd < s.amount_usd
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {s.option && <OptionTag option={s.option} />}
      <span className={cn(partly && NG)} title={partly ? `${money(s.guaranteed_usd)} guaranteed` : undefined}>
        {money(s.amount_usd)}
      </span>
    </span>
  )
}

/** No contract that season: a faint hairline, distinct from — (amount not recorded). */
function NoContract() {
  return (
    <>
      <span aria-hidden className="inline-block h-px w-2.5 bg-line-2 align-middle" />
      <span className="sr-only">No contract</span>
    </>
  )
}

/** The current cap sheet from the newest snapshot: players by season, options and guarantees marked. */
export function CapSheet({ data, currentSeason }: { data: ContractsPayload; currentSeason: number }) {
  const cur = (season: number) => season === currentSeason && 'bg-pacific/[0.045]'
  return (
    <Panel className="overflow-hidden">
      <TableScroll minWidth={140 + data.seasons.length * 130}>
        <thead>
          <tr>
            <Th align="left" sticky>
              Player
            </Th>
            {data.seasons.map((s) => (
              <Th key={s} className={cn('w-[150px]', cur(s), s === currentSeason && 'text-mute')}>
                {seasonLabel(s)}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.players.map((p) => {
            const bySeason = new Map(p.seasons.map((s) => [s.season_id, s]))
            return (
              <Tr key={p.person.person_key}>
                <Td align="left" sticky>
                  <span className="flex items-center gap-2.5">
                    <PlayerAvatar name={p.person.name} nbaPlayerId={p.person.nba_person_id} size={28} />
                    <PersonName person={p.person} className="font-medium text-text" />
                  </span>
                </Td>
                {data.seasons.map((season) => {
                  const s = bySeason.get(season)
                  return (
                    <Td key={season} className={cn(cur(season))}>
                      {s ? <Amount s={s} /> : <NoContract />}
                    </Td>
                  )
                })}
              </Tr>
            )
          })}
          <tr>
            <Td align="left" sticky className="border-line-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute">
              Total · {data.players.length} player{data.players.length === 1 ? '' : 's'}
            </Td>
            {data.seasons.map((season) => {
              const t = data.totals.find((x) => x.season_id === season)
              return (
                <Td key={season} className={cn('border-line-2 font-semibold text-text', season === currentSeason && 'bg-pacific/[0.07]')}>
                  {t?.amount_usd == null ? <span className="font-normal text-dim">—</span> : money(t.amount_usd)}
                </Td>
              )
            })}
          </tr>
        </tbody>
      </TableScroll>
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 border-t border-line px-4 pb-4 pt-3 font-mono text-[11px] text-dim sm:px-5 sm:pb-[18px] sm:pt-3.5">
        {(['player', 'team', 'early_termination'] as const).map((o) => (
          <span key={o} className="inline-flex items-center gap-[7px]">
            <OptionTag option={o} />
            {OPTION[o].legend}
          </span>
        ))}
        <span className="inline-flex items-center gap-[7px]">
          <span className={NG}>$2.5M</span>Not fully guaranteed
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden className="inline-block h-px w-2.5 bg-line-2" />
          No contract
        </span>
        <span>— Amount not recorded</span>
      </div>
    </Panel>
  )
}
