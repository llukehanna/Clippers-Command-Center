import type { Metadata } from 'next'
import { Eyebrow } from '@/components/ui/eyebrow'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel } from '@/components/ui/panel'
import { CoachTimeline } from '@/components/franchise/CoachTimeline'
import { ExecutiveList } from '@/components/franchise/ExecutiveList'
import { getJson } from '@/src/lib/ui/api'
import { calendarSeasonId } from '@/src/lib/season'
import { coachTenures, executiveGroups } from '@/src/lib/franchise/tenures'
import type { FrontOfficePayload } from '@/src/lib/ui/types'

export const metadata: Metadata = { title: 'Front office · Franchise' }

/** Front office: head coaches as a timeline with each season's record, then executives with their dates. */
export default async function FrontOfficePage() {
  const data = await getJson<FrontOfficePayload>('/api/franchise/front-office')
  if (!data) return <EmptyState title="The front office couldn't load" body="The data service didn't respond. Refresh in a moment." />
  if (data.coach_seasons.length === 0 && data.executives.length === 0) {
    return (
      <EmptyState
        title="No front office history yet"
        body="The franchise history import hasn't run. Every head coach since 1970, with their records, and the executives above them will show here."
      />
    )
  }
  const tenures = coachTenures(data.coach_seasons)
  const coaches = new Set(tenures.map((t) => t.coach.person_key)).size
  const first = data.coach_seasons.at(-1)?.season_id
  return (
    <section className="enter grid items-start gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:gap-[18px]" style={{ ['--i' as string]: 2 }}>
      <div className="min-w-0">
        <Eyebrow aside={coaches ? `${coaches} since ${first}` : undefined}>Head coaches</Eyebrow>
        {tenures.length ? (
          <CoachTimeline tenures={tenures} currentSeason={calendarSeasonId()} />
        ) : (
          <Panel className="px-5 py-6 text-[14px] text-mute">No head coaches recorded yet.</Panel>
        )}
      </div>
      <div className="min-w-0">
        <Eyebrow>Executives</Eyebrow>
        {data.executives.length ? (
          <ExecutiveList groups={executiveGroups(data.executives)} />
        ) : (
          <Panel className="px-5 py-6 text-[14px] text-mute">No executives recorded yet.</Panel>
        )}
      </div>
    </section>
  )
}
