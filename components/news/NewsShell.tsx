import { PageHeader } from '@/components/shell/PageHeader'
import { SegmentedLinks } from '@/components/ui/segmented-links'
import { NewsFeed, type NewsShow } from '@/components/news/NewsFeed'

const HREF: Record<NewsShow, string> = { all: '/news', articles: '/news/articles', social: '/news/social' }

/** Prerendered shell for the news tabs; the feed itself loads in the browser. */
export function NewsShell({ show }: { show: NewsShow }) {
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
              { value: 'all', label: 'All', href: HREF.all },
              { value: 'articles', label: 'Articles', href: HREF.articles },
              { value: 'social', label: 'Social', href: HREF.social },
            ]}
          />
        }
      />
      <NewsFeed show={show} />
    </div>
  )
}
