import type { Metadata } from 'next'
import { Eyebrow } from '@/components/ui/eyebrow'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel } from '@/components/ui/panel'
import { PicksOwedList } from '@/components/franchise/PicksOwedList'
import { getJson } from '@/src/lib/ui/api'
import type { OwedAsset, PicksOwedPayload } from '@/src/lib/ui/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Picks owed · Franchise' }

const count = (list: OwedAsset[]) => {
  const swaps = list.filter((a) => a.kind === 'swap').length
  const picks = list.length - swaps
  return [picks ? `${picks} pick${picks === 1 ? '' : 's'}` : null, swaps ? `${swaps} swap${swaps === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
}

function None({ children }: { children: string }) {
  return <Panel className="px-5 py-6 text-[14px] text-mute">{children}</Panel>
}

/** Picks owed: future picks and swaps the Clippers hold and owe, by year, with protections in plain words. */
export default async function PicksPage() {
  const data = await getJson<PicksOwedPayload>('/api/franchise/picks')
  if (!data) return <EmptyState title="Picks couldn't load" body="The data service didn't respond. Refresh in a moment." />
  if (data.owned.length + data.owed.length + data.uncertain.length === 0) {
    return (
      <EmptyState
        title="No future picks recorded yet"
        body="The franchise history import hasn't run. Picks and swaps the Clippers hold and owe will show here, with their protections."
      />
    )
  }
  return (
    <div className="grid gap-6 sm:gap-7 [&>*]:min-w-0">
      <section className="enter grid items-start gap-6 lg:grid-cols-2 lg:gap-[18px]" style={{ ['--i' as string]: 2 }}>
        <div className="min-w-0">
          <Eyebrow aside={count(data.owned) || undefined}>Clippers own</Eyebrow>
          {data.owned.length ? <PicksOwedList assets={data.owned} /> : <None>None recorded.</None>}
        </div>
        <div className="min-w-0">
          <Eyebrow aside={count(data.owed) || undefined}>Clippers owe</Eyebrow>
          {data.owed.length ? <PicksOwedList assets={data.owed} /> : <None>None recorded.</None>}
        </div>
      </section>
      {data.uncertain.length > 0 && (
        <section className="enter" style={{ ['--i' as string]: 3 }}>
          <Eyebrow aside={count(data.uncertain)}>May have been traded</Eyebrow>
          <PicksOwedList assets={data.uncertain} />
        </section>
      )}
    </div>
  )
}
