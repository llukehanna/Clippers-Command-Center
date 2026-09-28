import { cn } from '@/lib/utils'

/** Shared classes for Segmented (client) and SegmentedLinks (server). */
export function segmentedClasses(size: 'sm' | 'md') {
  return {
    group: 'inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full border border-line bg-white/[0.025] p-[3px] no-scrollbar',
    item: cn(
      'relative whitespace-nowrap rounded-full transition-[color,background-color,box-shadow] duration-300 ease-premium',
      size === 'sm' ? 'px-3 py-1 text-[12.5px]' : 'px-3.5 py-1.5 text-[13.5px]',
    ),
    active: 'bg-ink-3 text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_0_1px_var(--line)]',
    idle: 'text-mute hover:bg-white/[0.04] hover:text-text',
  }
}
