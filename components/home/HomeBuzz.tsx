'use client'

import useSWR from 'swr'
import { BuzzPanel } from '@/components/home/BuzzPanel'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchMedia } from '@/components/news/NewsFeed'
import type { MediaPayload } from '@/src/lib/ui/types'

/**
 * Home's news strip, fetched live in the browser (/api/media, edge-cached) so the
 * prerendered page needn't rebuild for news. While loading it holds roughly the
 * loaded strip's height; with nothing to show (or a failed load) it renders
 * nothing, as before.
 */
export function HomeBuzz({ index }: { index: number }) {
  const { data, error } = useSWR<MediaPayload>('/api/media?limit=3', fetchMedia, { revalidateOnFocus: false })

  if (!data) {
    if (error) return null
    return (
      <section aria-busy="true" aria-label="Loading news">
        <Skeleton className="mb-3.5 h-[11.5px] w-56 rounded-full" />
        {/* Typical loaded panel heights (3 headlines + 2 posts): ~438px on phones, ~359px wide. */}
        <Skeleton className="h-[438px] rounded-[22px] md:h-[359px]" />
      </section>
    )
  }
  if (data.articles.length === 0 && data.social.length === 0) return null
  return (
    <section className="enter" style={{ ['--i' as string]: index }}>
      <BuzzPanel articles={data.articles.slice(0, 3)} social={data.social.slice(0, 2)} />
    </section>
  )
}
