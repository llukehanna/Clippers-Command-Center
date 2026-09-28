import type { Metadata } from 'next'
import { PageHeader } from '@/components/shell/PageHeader'
import { SegmentedLinks } from '@/components/ui/segmented-links'
import { Eyebrow } from '@/components/ui/eyebrow'
import { EmptyState } from '@/components/ui/empty-state'
import { ArticleCard } from '@/components/news/ArticleCard'
import { SocialCard } from '@/components/news/SocialCard'
import { getJson } from '@/src/lib/ui/api'
import type { MediaPayload } from '@/src/lib/ui/types'

// Live data on every request (loaders read the database directly).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'News' }

type Show = 'all' | 'articles' | 'social'

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const params = await searchParams
  const show: Show = params.show === 'articles' || params.show === 'social' ? params.show : 'all'
  const data = await getJson<MediaPayload>('/api/media?limit=40')
  const href = (s: Show) => (s === 'all' ? '/news' : `/news?show=${s}`)

  const articles = data?.articles ?? []
  const social = data?.social ?? []
  const showArticles = show !== 'social'
  const showSocial = show !== 'articles'

  return (
    <div className="page">
      <PageHeader
        title="News"
        subtitle="From around the web · refreshed every 15 minutes"
        actions={
          <SegmentedLinks
            ariaLabel="Show"
            size="sm"
            value={show}
            options={[
              { value: 'all', label: 'All', href: href('all') },
              { value: 'articles', label: 'Articles', href: href('articles') },
              { value: 'social', label: 'Social', href: href('social') },
            ]}
          />
        }
      />
      {!data ? (
        <EmptyState title="News couldn't load" body="The data service didn't respond. Refresh in a moment." />
      ) : articles.length === 0 && social.length === 0 ? (
        <EmptyState title="Nothing new yet" body="Articles and posts from the last week show up here." />
      ) : (
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
      )}
    </div>
  )
}
