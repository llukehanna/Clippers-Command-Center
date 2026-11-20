import type { Metadata } from 'next'
import { NewsShell } from '@/components/news/NewsShell'

export const metadata: Metadata = { title: 'News' }

/** Prerendered shell; the feed loads live from /api/media in the browser. */
export default function NewsSocialPage() {
  return <NewsShell show="social" />
}
