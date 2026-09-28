import type { Metadata } from 'next'
import { NextGamePanel } from '@/components/game/NextGamePanel'
import { ScheduleChips } from '@/components/game/ScheduleChips'
import { ScheduleMonth } from '@/components/schedule/ScheduleList'
import { PageHeader } from '@/components/shell/PageHeader'
import { EmptyState } from '@/components/ui/empty-state'
import { getJson } from '@/src/lib/ui/api'
import { annotateSchedule, groupByMonth } from '@/src/lib/ui/schedule'
import type { SchedulePayload } from '@/src/lib/ui/types'

// Live data on every request (loaders read the database directly).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Schedule' }

export default async function SchedulePage() {
  const data = await getJson<SchedulePayload>('/api/schedule')

  if (!data) {
    return (
      <div className="page">
        <PageHeader title="Schedule" />
        <EmptyState title="The schedule couldn't load" body="The data service didn't respond. Refresh in a moment." />
      </div>
    )
  }

  const games = annotateSchedule(data.games ?? [])
  const [next, ...rest] = games
  const homeCount = games.filter((g) => g.home_away === 'home').length
  const b2bCount = games.filter((g) => g.annotation.b2b).length

  return (
    <div className="page">
      <PageHeader
        title="Schedule"
        subtitle={
          games.length > 0
            ? `Next ${games.length} games · ${homeCount} home, ${games.length - homeCount} away${b2bCount ? ` · ${b2bCount} back-to-back${b2bCount === 1 ? '' : 's'}` : ''} · times PT`
            : 'Upcoming Clippers games'
        }
      />

      <div className="enter" style={{ ['--i' as string]: 0 }}>
        <NextGamePanel
          game={next ?? null}
          context={
            next ? (
              <span className="flex flex-wrap justify-end gap-1.5">
                <ScheduleChips annotation={next.annotation} />
              </span>
            ) : null
          }
        />
      </div>

      {rest.length > 0 &&
        groupByMonth(rest).map((m, i) => (
          <div key={m.key} className="enter" style={{ ['--i' as string]: i + 1 }}>
            <ScheduleMonth label={m.label} games={m.games} />
          </div>
        ))}
    </div>
  )
}
