import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import type { InsightCardData } from '@/src/lib/insights/card'
import type { ReceiptTable } from '@/src/lib/insights/receipts'
import { headerLines, tileParts } from '@/src/lib/insights/tile'
import { CardVisualView } from './CardVisualView'
import { Receipts } from './Receipts'
import { SubjectMark } from './SubjectMark'
import { WhyChip } from './WhyChip'

interface InsightTileProps {
  card: InsightCardData
  size: 'hero' | 'standard'
  /** False on the player page: the header leads with the game, no avatar. */
  showSubject?: boolean
}

// insights.css:37-38 (.ic) and :70-74 (.ic.hero), including the hero's own glow.
// The hero clips rather than hides its overflow: the glow pokes out past the
// right edge, and a hidden-overflow box can still be scrolled sideways when
// focus moves to its Receipts button. min-w-0 lets the card shrink inside a
// grid with implicit (auto) columns instead of sizing to its nowrap header.
const BASE = 'flex min-w-0 flex-col transition-transform duration-[350ms] ease-premium hover:-translate-y-px'
const STANDARD = 'gap-2.5 px-[18px] pb-3 pt-4'
const HERO =
  'overflow-clip gap-3 px-6 pb-3.5 pt-[22px] max-sm:px-4 max-sm:pb-3 max-sm:pt-[18px] [&>.hero-glow]:[inset:-55%_-20%_auto_auto] [&>.hero-glow]:size-[520px] [&>.hero-glow]:bg-[radial-gradient(closest-side,rgba(65,143,222,0.24),transparent)]'

/**
 * One insight as a card (hero or standard). The whole card links to its game
 * or player through a stretched link; the footer (and the Receipts button in
 * it) sits above that link, so nothing interactive is nested inside it.
 * Legacy and live cards render plain: no chip, visual or Receipts.
 */
export function InsightTile({ card, size, showSubject = true }: InsightTileProps) {
  const hero = size === 'hero'
  const parts = tileParts(card)
  const { name, sub } = headerLines(card, showSubject)
  const visual = parts.visual ? (
    <div className="mt-1 text-mute empty:hidden">
      <CardVisualView visual={parts.visual} size={size} />
    </div>
  ) : null

  return (
    <Panel as="article" variant={hero ? 'hero' : 'default'} className={cn(BASE, hero ? HERO : STANDARD)}>
      {card.href && (
        <Link href={card.href} aria-label={card.headline} className="absolute inset-0 z-[2] rounded-[inherit]" />
      )}

      <header className="flex min-w-0 items-center gap-2.5">
        {showSubject && <SubjectMark subject={card.subject} size={hero ? 34 : 28} />}
        <span className="flex min-w-0 flex-col gap-px">
          <span className="truncate text-[13px] font-medium tracking-[-0.01em] text-text">{name}</span>
          {sub && <span className="truncate font-mono text-[10.5px] tracking-[0.02em] text-dim">{sub}</span>}
        </span>
        {parts.chip && <WhyChip chip={parts.chip} className="ml-auto" />}
      </header>

      {hero ? (
        <div
          className={cn(
            'grid grid-cols-[minmax(0,1fr)] gap-3.5',
            visual && 'min-[760px]:grid-cols-[minmax(0,1fr)_300px] min-[760px]:items-center min-[760px]:gap-6',
          )}
        >
          <div>
            <Headline hero text={card.headline} />
            {card.detail && <Detail hero text={card.detail} />}
          </div>
          {visual && (
            <div>
              {parts.big && (
                <div className="mb-3.5 flex items-end gap-3">
                  <span className="bg-[linear-gradient(180deg,#fff,#9cc7f2)] bg-clip-text text-[56px] font-semibold leading-[0.9] tracking-[-0.05em] text-transparent">
                    {parts.big.n}
                  </span>
                  <span className="pb-1 font-mono text-[11px] leading-[1.4] text-mute">{parts.big.unit}</span>
                </div>
              )}
              {visual}
            </div>
          )}
        </div>
      ) : (
        <>
          <Headline text={card.headline} />
          {card.detail && <Detail text={card.detail} />}
          {visual}
        </>
      )}

      <Footer sample={parts.sample} receipts={parts.receipts} />
    </Panel>
  )
}

function Headline({ text, hero }: { text: string; hero?: boolean }) {
  return (
    <h3
      className={cn(
        'm-0 mt-0.5 font-semibold text-text',
        hero
          ? 'text-[23px] leading-[1.22] tracking-[-0.03em] sm:text-[27px]'
          : 'text-[16.5px] leading-[1.3] tracking-[-0.02em]',
      )}
    >
      {text}
    </h3>
  )
}

function Detail({ text, hero }: { text: string; hero?: boolean }) {
  return (
    <p className={cn('m-0 leading-[1.45] text-mute', hero ? 'mt-2 text-[15px]' : 'text-[13.5px]')}>{text}</p>
  )
}

function Footer({ sample, receipts }: { sample: string | null; receipts: ReceiptTable | null }) {
  return (
    <footer className="relative z-[3] mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-dashed border-line-2 pt-2.5 font-mono text-[10.5px] text-dim">
      <span className="text-pos">✓ Verified</span>
      {sample && <span>{sample}</span>}
      {receipts && <Receipts table={receipts} />}
    </footer>
  )
}
