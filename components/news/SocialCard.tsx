import { ageLabel } from '@/src/lib/ui/time'
import type { MediaItem } from '@/src/lib/ui/types'
import { TweetEmbed } from './TweetEmbed'

const KIND_LABEL: Record<MediaItem['kind'], string> = { article: 'Article', reddit: 'Reddit', tweet: 'Post on X', bluesky: 'Bluesky' }

function TextPost({ item }: { item: MediaItem }) {
  const age = ageLabel(item.published_at)
  const stats = [
    item.engagement != null ? `${item.kind === 'reddit' || item.kind === 'tweet' ? '▲' : '♥'} ${item.engagement.toLocaleString('en-US')}` : null,
    item.comments != null ? `${item.comments.toLocaleString('en-US')} comments` : null,
  ].filter(Boolean)
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="row-hover flex flex-col gap-1 rounded-[14px] px-3.5 py-3">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim">
        {KIND_LABEL[item.kind]} · {item.kind === 'bluesky' ? item.author : item.source}
        {age && ` · ${age}`}
      </span>
      <span className="text-[14px] leading-snug text-text">{item.title}</span>
      {stats.length > 0 && <span className="font-mono text-[11px] text-mute">{stats.join(' · ')}</span>}
    </a>
  )
}

/** A social post: X posts embed (when `embed`), everything else renders as text. */
export function SocialCard({ item, embed = true }: { item: MediaItem; embed?: boolean }) {
  if (embed && item.kind === 'tweet' && item.embed_url) {
    return <TweetEmbed url={item.embed_url} fallback={<TextPost item={item} />} />
  }
  return <TextPost item={item} />
}
