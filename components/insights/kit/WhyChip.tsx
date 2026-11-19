import { cn } from '@/lib/utils'
import type { WhyChip as WhyChipData, WhyTone } from '@/src/lib/insights/why'

// insights.css:24-34 (.why and its tones)
const TONES: Record<WhyTone, string> = {
  rare: 'text-[#b9d8f6] bg-[rgba(65,143,222,0.16)] shadow-[inset_0_0_0_1px_rgba(65,143,222,0.38)]',
  career: 'text-[#8fe0b7] bg-[rgba(76,195,138,0.13)] shadow-[inset_0_0_0_1px_rgba(76,195,138,0.34)]',
  gold: 'text-[#f0cd74] bg-[rgba(227,179,65,0.13)] shadow-[inset_0_0_0_1px_rgba(227,179,65,0.36)]',
  low: 'text-[#f6a2ae] bg-[rgba(240,103,122,0.12)] shadow-[inset_0_0_0_1px_rgba(240,103,122,0.32)]',
  ctx: 'text-mute bg-white/[0.04] shadow-[inset_0_0_0_1px_var(--line-2)]',
}

/** The "why it matters" chip: the frame in two or three words. */
export function WhyChip({ chip, className }: { chip: WhyChipData; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-2 pr-[9px] font-mono text-[10px] leading-none uppercase tracking-[0.1em] before:h-[5px] before:w-[5px] before:rounded-[2px] before:bg-current before:content-['']",
        TONES[chip.tone],
        className,
      )}
    >
      {chip.label}
    </span>
  )
}
