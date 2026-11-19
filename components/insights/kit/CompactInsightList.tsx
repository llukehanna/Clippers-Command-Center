import * as React from 'react'
import Link from 'next/link'
import { Panel } from '@/components/ui/panel'
import type { InsightCardData } from '@/src/lib/insights/card'
import { compactMeta, tileParts } from '@/src/lib/insights/tile'
import { SubjectMark } from './SubjectMark'
import { WhyChip } from './WhyChip'

// insights.css:80-88 (.icl / .icr). On phones the chip drops under the text.
const ROW =
  'relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-2.5 py-[11px] max-sm:grid-cols-[auto_minmax(0,1fr)]'

/** Compact insight rows: headshot, headline, detail, date · context, chip. No visual. */
export function CompactInsightList({ cards }: { cards: InsightCardData[] }) {
  if (cards.length === 0) return null
  return (
    <Panel className="min-w-0 p-1.5">
      <ol className="divide-y divide-line">
        {cards.map((card) => (
          <li key={card.insight_id}>
            <Row card={card} />
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function Row({ card }: { card: InsightCardData }) {
  const { chip } = tileParts(card)
  const body: React.ReactNode = (
    <>
      <SubjectMark subject={card.subject} size={32} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13.5px] font-medium leading-[1.35] tracking-[-0.01em] text-text">{card.headline}</span>
        {card.detail && <span className="text-[12.5px] leading-[1.35] text-mute">{card.detail}</span>}
        <span className="font-mono text-[10.5px] text-dim">{compactMeta(card)}</span>
      </span>
      {chip && (
        <WhyChip
          chip={chip}
          className="mt-0.5 self-start max-sm:order-3 max-sm:col-start-2 max-sm:mt-0 max-sm:justify-self-start"
        />
      )}
    </>
  )
  return card.href ? (
    <Link href={card.href} className={`row-hover ${ROW}`}>
      {body}
    </Link>
  ) : (
    <div className={ROW}>{body}</div>
  )
}
