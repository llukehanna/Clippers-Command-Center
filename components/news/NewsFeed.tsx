'use client'

import useSWR from 'swr'
import { Eyebrow } from '@/components/ui/eyebrow'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonRows } from '@/components/shell/PageSkeleton'
import { ArticleCard } from '@/components/news/ArticleCard'
import { SocialCard } from '@/components/news/SocialCard'
import type { MediaPayload } from '@/src/lib/ui/types'

export type NewsShow = 'all' | 'articles' | 'social'

/** Fetched live in the browser (/api/media is edge-cached), so news stays fresh without rebuilding pages. */
export const fetchMedia = (url: string): Promise<MediaPayload> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

/** Articles and/or social posts for /news, /news/articles, /news/social. Switching tabs reuses the loaded feed. */
export function NewsFeed({ show }: { show: NewsShow }) {
  const { data, error } = useSWR<MediaPayload>('/api/media?limit=40', fetchMedia, { revalidateOnFocus: false })

  if (!data) {
    if (error) return <EmptyState title="News couldn't load" body="The data service didn't respond. Refresh in a moment." />
    return (
      <div aria-busy="true" aria-label="Loading">
        <SkeletonRows count={7} />
      </div>
    )
  }

  const articles = data.articles ?? []
  const social = data.social ?? []
  const showArticles = show !== 'social'
  const showSocial = show !== 'articles'

  if (articles.length === 0 && social.length === 0) {
    return <EmptyState title="Nothing new yet" body="Articles and posts from the last week show up here." />
  }

  return (
    <div className={`enter grid grid-cols-1 items-start gap-6 lg:gap-[18px] ${showArticles && showSocial ? 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]' : ''}`}>
      {showArticles && (
        <section>
          <Eyebrow aside={`${articles.length}`}>Articles</Eyebrow>
          {articles.length ? (
            <div className="panel p-1.5">{articles.map((a) => <ArticleCard key={a.media_id} item={a} />)}</div>
          ) : (
            <EmptyState title="No articles this week" />
          )}
        </section>
      )}
      {showSocial && (
        <section>
          <Eyebrow aside="hottest first">Social</Eyebrow>
          {social.length ? (
            <div className="flex flex-col gap-2.5">
              {social.map((s) => (
                <div key={s.media_id} className="panel p-1.5">
                  <SocialCard item={s} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No posts yet" />
          )}
        </section>
      )}
    </div>
  )
}
