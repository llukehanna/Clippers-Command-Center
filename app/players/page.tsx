import type { Metadata } from 'next'
import { PageHeader } from '@/components/shell/PageHeader'
import { RosterCards, RosterTable } from '@/components/players/RosterGrid'
import { AllTimePlayers } from '@/components/players/AllTimePlayers'
import { SegmentedLinks } from '@/components/ui/segmented-links'
import { EmptyState } from '@/components/ui/empty-state'
import { getJson } from '@/src/lib/ui/api'
import { formatSeasonLabel } from '@/src/lib/home-utils'
import type { PlayersPayload } from '@/src/lib/ui/types'
import type { AllTimePayload } from '@/src/lib/data/players-all-time'

// Live data on every request (loaders read the database directly).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Players' }

type View = 'cards' | 'table'
type Scope = 'active' | 'all'
type Mode = 'roster' | 'all-time'

export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ view?: string; scope?: string; mode?: string }> }) {
  const params = await searchParams
  const mode: Mode = params.mode === 'all-time' ? 'all-time' : 'roster'
  const modeToggle = (
    <SegmentedLinks
      ariaLabel="Players"
      size="sm"
      value={mode}
      options={[
        { value: 'roster', label: 'Roster', href: '/players' },
        { value: 'all-time', label: 'All-time', href: '/players?mode=all-time' },
      ]}
    />
  )

  if (mode === 'all-time') {
    const allTime = await getJson<AllTimePayload>('/api/players/all-time')
    const players = allTime?.players ?? []
    const seasons = players.length ? Math.max(...players.map((p) => p.last_season)) - Math.min(...players.map((p) => p.first_season)) + 1 : 0
    return (
      <div className="page">
        <PageHeader
          title="Players"
          subtitle={
            allTime ? `All-time · ${players.length} players in ${seasons} seasons · Buffalo Braves, San Diego and LA Clippers` : undefined
          }
          actions={modeToggle}
        />
        {!allTime ? (
          <EmptyState title="The all-time list couldn't load" body="The data service didn't respond. Refresh in a moment." />
        ) : (
          <AllTimePlayers players={players} />
        )}
      </div>
    )
  }

  const view: View = params.view === 'table' ? 'table' : 'cards'
  const scope: Scope = params.scope === 'all' ? 'all' : 'active'
  const data = await getJson<PlayersPayload>(`/api/players${scope === 'all' ? '?include_traded=true' : ''}`)

  const href = (next: Partial<{ view: View; scope: Scope }>) => {
    const q = new URLSearchParams()
    const v = next.view ?? view
    const s = next.scope ?? scope
    if (v !== 'cards') q.set('view', v)
    if (s !== 'active') q.set('scope', s)
    const qs = q.toString()
    return qs ? `/players?${qs}` : '/players'
  }

  const players = [...(data?.players ?? [])].sort((a, b) => Number(!!a.is_traded) - Number(!!b.is_traded) || a.display_name.localeCompare(b.display_name))
  const season = data?.season_id != null ? formatSeasonLabel(data.season_id).replace('-', '–') : null

  return (
    <div className="page">
      <PageHeader
        title="Players"
        subtitle={data ? `${players.length} players · ${season} roster` : undefined}
        actions={
          <>
            {modeToggle}
            <SegmentedLinks
              ariaLabel="Roster scope"
              size="sm"
              value={scope}
              options={[
                { value: 'active', label: 'Current', href: href({ scope: 'active' }) },
                { value: 'all', label: 'Incl. traded', href: href({ scope: 'all' }) },
              ]}
            />
            <SegmentedLinks
              ariaLabel="Layout"
              size="sm"
              value={view}
              options={[
                { value: 'cards', label: 'Cards', href: href({ view: 'cards' }) },
                { value: 'table', label: 'Table', href: href({ view: 'table' }) },
              ]}
            />
          </>
        }
      />
      {!data ? (
        <EmptyState title="The roster couldn't load" body="The data service didn't respond. Refresh in a moment." />
      ) : players.length === 0 ? (
        <EmptyState title="No players on this roster yet" />
      ) : view === 'cards' ? (
        <RosterCards players={players} />
      ) : (
        <RosterTable players={players} />
      )}
    </div>
  )
}
