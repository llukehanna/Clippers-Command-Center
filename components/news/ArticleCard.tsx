import { cn } from '@/lib/utils'
import { ageLabel } from '@/src/lib/ui/time'
import type { MediaItem } from '@/src/lib/ui/types'

/** External article link — source, headline, age, optional thumbnail. */
export function ArticleCard({ item, compact = false }: { item: MediaItem; compact?: boolean }) {
  const age = ageLabel(item.published_at)
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('row-hover flex items-start gap-3.5 rounded-[14px]', compact ? 'px-3 py-2.5' : 'px-3.5 py-3')}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim">
          <span className="truncate">{item.source}</span>
          {age && (
            <span>
              · {age}
              <span className="sr-only"> ago</span>
            </span>
          )}
        </div>
        <p className={cn('m-0 leading-snug text-text', compact ? 'text-[13.5px]' : 'text-[15px] font-medium')}>{item.title}</p>
        {!compact && item.author && <p className="m-0 mt-1 text-[12.5px] text-mute">{item.author}</p>}
        <span className="sr-only"> (opens in new tab)</span>
      </div>
      {!compact && item.thumbnail_url && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary publisher hosts; no image proxy
        <img
          src={item.thumbnail_url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-[64px] w-[96px] shrink-0 rounded-[10px] border border-line object-cover"
        />
      )}
    </a>
  )
}
