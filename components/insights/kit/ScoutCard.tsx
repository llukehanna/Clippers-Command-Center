import type { InsightCardData } from '@/src/lib/insights/card'
import { tileParts } from '@/src/lib/insights/tile'
import { CardVisualView } from './CardVisualView'
import { WhyChip } from './WhyChip'

/**
 * A scouting note about the opponent (insights.css:190-195). No links or
 * buttons, so it is safe inside the Home NextGamePanel link.
 */
export function ScoutCard({ card }: { card: InsightCardData }) {
  const { chip, visual } = tileParts(card)
  const rank = visual?.kind === 'evidence' && visual.evidence.type === 'rank_track' ? visual : null
  return (
    <div className="panel-inset grid min-w-0 gap-2 px-3.5 pb-3 pt-3.5">
      {chip && <WhyChip chip={chip} className="justify-self-start" />}
      <div className="text-[14px] font-medium leading-[1.35] tracking-[-0.01em] text-text">{card.headline}</div>
      {rank && (
        <div className="text-mute empty:hidden">
          <CardVisualView visual={rank} size="standard" />
        </div>
      )}
      {card.detail && <div className="text-[12px] text-mute">{card.detail}</div>}
    </div>
  )
}
