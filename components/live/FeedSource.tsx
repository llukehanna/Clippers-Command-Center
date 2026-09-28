import { cn } from '@/lib/utils'
import type { FeedSource as Source } from '@/src/lib/live/stream'

const LABEL: Record<Exclude<Source, 'idle'>, string> = {
  push: 'Live',
  poll: 'Live · polling',
  backup: 'Backup feed · ESPN',
}

/** Which tier is feeding /live right now (spec §6.2). */
export function FeedSource({ source }: { source: Source }) {
  if (source === 'idle') return null
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-1.5 font-mono text-[11.5px]', source === 'backup' ? 'text-warn' : 'text-mute')}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 rounded-full', source === 'push' ? 'bg-live' : source === 'backup' ? 'bg-warn' : 'bg-mute')}
      />
      {LABEL[source]}
    </span>
  )
}
