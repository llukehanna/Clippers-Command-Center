import type { Metadata } from 'next'
import { Eyebrow } from '@/components/ui/eyebrow'
import { EmptyState } from '@/components/ui/empty-state'
import { CapSheet } from '@/components/franchise/CapSheet'
import { PayrollChart } from '@/components/franchise/PayrollChart'
import { getJson } from '@/src/lib/ui/api'
import { calendarSeasonId } from '@/src/lib/season'
import { moveDate, seasonLabel } from '@/src/lib/franchise/display'
import type { ContractsPayload } from '@/src/lib/ui/types'

export const metadata: Metadata = { title: 'Contracts · Franchise' }

/** Contracts: the current cap sheet (newest snapshot only), then payroll by season from 1984–85. */
export default async function ContractsPage() {
  const data = await getJson<ContractsPayload>('/api/franchise/contracts')
  if (!data) return <EmptyState title="Contracts couldn't load" body="The data service didn't respond. Refresh in a moment." />

  const payroll = data.payroll
  const oldest = payroll.at(-1)
  const newest = payroll[0]
  return (
    <div className="grid gap-6 sm:gap-7 [&>*]:min-w-0">
      <section className="enter" style={{ ['--i' as string]: 2 }}>
        <Eyebrow aside={data.snapshot_fetched_at ? `Updated ${moveDate(data.snapshot_fetched_at)}` : undefined}>Cap sheet</Eyebrow>
        {data.snapshot_id && data.players.length > 0 ? (
          <CapSheet data={data} currentSeason={calendarSeasonId()} />
        ) : (
          <EmptyState title="No cap sheet recorded yet" body="The contracts import hasn't run. Current deals, options and guarantees will show here once it does." />
        )}
      </section>

      <section className="enter" style={{ ['--i' as string]: 3 }}>
        <Eyebrow aside={oldest && newest ? `${seasonLabel(oldest.season_id)} to ${seasonLabel(newest.season_id)}` : undefined}>Payroll by season</Eyebrow>
        {payroll.length > 0 ? (
          <PayrollChart payroll={payroll} />
        ) : (
          <EmptyState title="No payroll history yet" body="The franchise history import hasn't run. Payroll for every season since 1984–85 will show here." />
        )}
      </section>
    </div>
  )
}
