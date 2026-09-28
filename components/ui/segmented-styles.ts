import { cn } from '@/lib/utils'

/** Shared classes for Segmented (client state) and SegmentedLinks (URL state). */
export function segmentedClasses(size: 'sm' | 'md') {
  return {
    group: 'glass-track relative inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full p-[3px] no-scrollbar',
    item: cn(
      'press relative z-10 whitespace-nowrap rounded-full transition-colors duration-300 ease-premium',
      size === 'sm' ? 'px-3 py-1 text-[12.5px]' : 'px-3.5 py-1.5 text-[13.5px]',
    ),
    active: 'text-white',
    idle: 'text-mute hover:text-text',
    lens: 'lens pointer-events-none absolute left-0 top-0 rounded-full',
  }
}
