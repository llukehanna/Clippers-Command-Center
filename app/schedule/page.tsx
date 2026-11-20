import type { Metadata } from 'next'
import { NextGamePanel } from '@/components/game/NextGamePanel'
import { ScheduleChips } from '@/components/game/ScheduleChips'
import { ScheduleMonth } from '@/components/schedule/ScheduleList'
import { PageHeader } from '@/components/shell/PageHeader'
import { EmptyState } from '@/components/ui/empty-state'
import { ClockWindow } from '@/components/ui/clock'
import { SITE_URL } from '@/src/lib/ics'
import { getJson } from '@/src/lib/ui/api'
import { annotateSchedule, groupByMonth } from '@/src/lib/ui/schedule'
import { gamesOverAt, slotWindow } from '@/src/lib/ui/clock'
import type { SchedulePayload } from '@/src/lib/ui/types'

export const metadata: Metadata = { title: 'Schedule' }

// Prerendered: the hero carries the first few games and the browser shows the
// first not yet over, dropping it from the list below (a late or failed
// post-final rebuild never leaves a finished game as "next").
const HERO_SLOTS = 3

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
  const overAt = gamesOverAt(games)
  const rest = games.slice(1).map((g, k) => ({ ...g, window: slotWindow(overAt, k + 1, 1, Infinity) }))
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
        actions={
          <a
            href={`${SITE_URL.replace('https://', 'webcal://')}/schedule.ics`}
            className="inline-flex font-mono text-[12px] text-mute transition-colors hover:text-text"
          >
            Subscribe to calendar ↗
          </a>
        }
      />

      <div className="enter" style={{ ['--i' as string]: 0 }}>
        {games.slice(0, HERO_SLOTS).map((g, i) => (
          <ClockWindow key={g.game_id} {...slotWindow(overAt, i, 0, 1)}>
            <NextGamePanel
              game={g}
              href={`/schedule/${g.game_id}`}
              context={
                <span className="flex flex-wrap justify-end gap-1.5">
                  <ScheduleChips annotation={g.annotation} />
                </span>
              }
            />
          </ClockWindow>
        ))}
        {games.length <= HERO_SLOTS && (
          <ClockWindow from={overAt.at(-1)} initial={games.length === 0}>
            <NextGamePanel game={null} />
          </ClockWindow>
        )}
      </div>

      {rest.length > 0 &&
        groupByMonth(rest).map((m, i) => (
          // Games leave from the front, so a month is gone once its last game is.
          <ClockWindow key={m.key} {...m.games.at(-1)!.window}>
            <div className="enter" style={{ ['--i' as string]: i + 1 }}>
              <ScheduleMonth label={m.label} games={m.games} />
            </div>
          </ClockWindow>
        ))}
    </div>
  )
}
