import Link from 'next/link'
import { Eyebrow } from '@/components/ui/eyebrow'
import { ArticleCard } from '@/components/news/ArticleCard'
import { SocialCard } from '@/components/news/SocialCard'
import type { MediaItem } from '@/src/lib/ui/types'

/** Top headlines and the hottest posts, linking to /news. Text only — no embeds on Home. */
export function BuzzPanel({ articles, social }: { articles: MediaItem[]; social: MediaItem[] }) {
  if (articles.length === 0 && social.length === 0) return null
  return (
    <div>
      <Eyebrow aside={<Link href="/news" className="hover:text-text">All news →</Link>}>Buzz · from around the web</Eyebrow>
      <div className="panel p-1.5">
        {articles.map((a) => <ArticleCard key={a.media_id} item={a} compact />)}
        {social.map((s) => <SocialCard key={s.media_id} item={s} embed={false} />)}
      </div>
    </div>
  )
}
