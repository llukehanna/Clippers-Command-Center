import { cn } from '@/lib/utils'
import { lotteryLine } from '@/src/lib/franchise/display'
import type { DraftLottery } from '@/src/lib/ui/types'

/**
 * A lottery result on a 14-slot track: the outlined slot is where the pick entered,
 * the filled one where it landed (green up, red down, pacific unchanged).
 */
export function LotteryLine({ lottery }: { lottery: DraftLottery }) {
  const from = lottery.pre_lottery_slot
  const to = lottery.pick_won
  const text = lotteryLine(lottery)
  const slots = Math.max(14, from ?? 0, to ?? 0)
  const up = from != null && to != null && to < from
  const lo = from != null && to != null ? Math.min(from, to) : 0
  const hi = from != null && to != null ? Math.max(from, to) : 0
  const track = from != null && to != null ? `Entered slot ${from}, landed at ${to}` : 'Lottery slots not recorded'

  return (
    <div className="panel-inset mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-[12px] px-2.5 py-2.5 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:px-3">
      <span className="label-mono max-sm:col-span-full">Lottery</span>
      <span role="img" aria-label={track} className="relative grid h-[26px] grid-cols-[repeat(14,12px)] max-sm:mb-2.5 items-center gap-0.5 sm:grid-cols-[repeat(14,14px)] sm:gap-[3px]" style={{ gridTemplateColumns: slots > 14 ? `repeat(${slots}, 10px)` : undefined }}>
        {Array.from({ length: slots }, (_, i) => {
          const n = i + 1
          const land = n === to
          const entry = n === from && !land
          const path = n > lo && n < hi
          const label = land || entry || n === slots ? n : null
          return (
            <i
              key={n}
              className={cn(
                'relative block rounded-[2px]',
                land
                  ? cn(
                      'h-3 rounded-[3px]',
                      from == null || from === to
                        ? 'bg-pacific shadow-[0_0_10px_-1px_rgba(65,143,222,0.7)]'
                        : up
                          ? 'bg-pos shadow-[0_0_10px_-1px_rgba(76,195,138,0.7)]'
                          : 'bg-neg shadow-[0_0_10px_-1px_rgba(240,103,122,0.7)]',
                    )
                  : entry
                    ? 'h-3 rounded-[3px] shadow-[inset_0_0_0_1px_var(--mute)]'
                    : path
                      ? cn('h-1', up ? 'bg-pos/40' : 'bg-neg/40')
                      : 'h-1 bg-line-2',
              )}
            >
              {label != null && (
                <span className={cn('absolute left-1/2 top-3.5 -translate-x-1/2 font-mono text-[9.5px] not-italic', land ? 'text-text' : 'text-dim')}>{label}</span>
              )}
            </i>
          )
        })}
      </span>
      <span className="text-[13px] text-mute max-sm:col-span-full">
        {text.entered}
        <span className="font-mono text-[12px] text-dim"> · {text.odds}</span>
        {text.outcome && (
          <>
            <span className="font-mono text-[12px] text-dim"> · </span>
            <span className={cn(text.tone === 'pos' && 'text-pos', text.tone === 'neg' && 'text-neg')}>{text.outcome}</span>
          </>
        )}
        {lottery.tie_unresolved && <span className="font-mono text-[11px] text-dim"> · tie not resolved</span>}
      </span>
    </div>
  )
}
