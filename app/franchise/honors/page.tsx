import type { Metadata } from 'next'
import { Eyebrow } from '@/components/ui/eyebrow'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel } from '@/components/ui/panel'
import { AwardsBySeason, HallOfFame, RetiredNumbers } from '@/components/franchise/HonorsList'
import { PersonName } from '@/components/franchise/bits'
import { getJson } from '@/src/lib/ui/api'
import type { HonorsPayload } from '@/src/lib/ui/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Honors · Franchise' }

/** Honors: retired numbers first, then Hall of Famers, then awards and All-Star selections by season. */
export default async function HonorsPage() {
  const data = await getJson<HonorsPayload>('/api/franchise/honors')
  if (!data) return <EmptyState title="Honors couldn't load" body="The data service didn't respond. Refresh in a moment." />
  const total = data.retired_number.length + data.retired_number_league.length + data.hall_of_fame.length + data.awards_by_season.length + data.other.length
  if (total === 0) {
    return (
      <EmptyState
        title="No honors recorded yet"
        body="The franchise history import hasn't run. Retired numbers, Hall of Famers and every award and All-Star selection will show here."
      />
    )
  }
  return (
    <div className="grid gap-6 sm:gap-7 [&>*]:min-w-0">
      <section className="enter" style={{ ['--i' as string]: 2 }}>
        <Eyebrow>Retired numbers</Eyebrow>
        <RetiredNumbers own={data.retired_number} league={data.retired_number_league} />
      </section>

      <section className="enter grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] lg:gap-[18px]" style={{ ['--i' as string]: 3 }}>
        <div className="grid min-w-0 gap-6">
          <div>
            <Eyebrow aside={data.hall_of_fame.length || undefined}>Hall of Famers</Eyebrow>
            {data.hall_of_fame.length ? <HallOfFame rows={data.hall_of_fame} /> : <Panel className="px-5 py-6 text-[14px] text-mute">None recorded yet.</Panel>}
          </div>
          {data.other.length > 0 && (
            <div>
              <Eyebrow>Other honors</Eyebrow>
              <Panel className="p-2">
                {data.other.map((h) => (
                  <div key={`${h.honor}-${h.person.person_key}-${h.detail}`} className="row-hover flex items-baseline justify-between gap-3 rounded-[14px] px-3 py-2.5">
                    <PersonName person={h.person} className="text-[14.5px] font-medium" />
                    <span className="text-right text-[13px] text-mute">
                      {h.label}
                      {h.detail && <span className="font-mono text-[11px] text-dim"> · {h.detail}</span>}
                    </span>
                  </div>
                ))}
              </Panel>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <Eyebrow aside="by season">Awards and All-Stars</Eyebrow>
          {data.awards_by_season.length ? <AwardsBySeason seasons={data.awards_by_season} /> : <Panel className="px-5 py-6 text-[14px] text-mute">None recorded yet.</Panel>}
        </div>
      </section>
    </div>
  )
}
