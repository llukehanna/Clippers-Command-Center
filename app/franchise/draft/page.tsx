import type { Metadata } from 'next'
import { Panel } from '@/components/ui/panel'
import { EmptyState } from '@/components/ui/empty-state'
import { DraftYear } from '@/components/franchise/DraftYear'
import { getJson } from '@/src/lib/ui/api'
import type { DraftPayload } from '@/src/lib/ui/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Draft · Franchise' }

/** Draft: every pick the Clippers held, by year, newest first; traded-away picks dimmed. */
export default async function DraftPage() {
  const data = await getJson<DraftPayload>('/api/franchise/draft')
  if (!data) return <EmptyState title="The draft couldn't load" body="The data service didn't respond. Refresh in a moment." />
  if (data.years.length === 0) {
    return (
      <EmptyState
        title="No draft history yet"
        body="The franchise history import hasn't run. Every pick since 1970 will show here, newest draft first."
      />
    )
  }
  return (
    <Panel as="div" className="enter py-1" style={{ ['--i' as string]: 2 }}>
      {data.years.map((y) => (
        <DraftYear key={y.draft_year} year={y.draft_year} picks={y.picks} />
      ))}
    </Panel>
  )
}
