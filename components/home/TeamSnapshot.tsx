// components/home/TeamSnapshot.tsx
// Server Component — renders five stat cards for the team snapshot row.

import { StatCard } from '@/components/stat-card/StatCard'
import { formatSeasonLabel } from '@/src/lib/home-utils'

interface TeamSnapshotProps {
  snapshot: {
    season_id?: number
    record: { wins: number; losses: number }
    conference_seed?: number | null
    last_10: { wins: number; losses: number }
    net_rating: number | null
    off_rating: number | null
    def_rating: number | null
  }
}

export function TeamSnapshot({ snapshot }: TeamSnapshotProps) {
  const { record, last_10, net_rating, off_rating, def_rating, conference_seed, season_id } = snapshot
  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
  }

  return (
    <div className="space-y-2">
    {typeof season_id === 'number' && (
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {formatSeasonLabel(season_id).replace('-', '–')} regular season
      </p>
    )}
    <div className="grid grid-cols-5 gap-3">
      <StatCard
        label={conference_seed ? `Record · ${ordinal(conference_seed)} West` : 'Record'}
        value={`${record.wins}–${record.losses}`}
      />
      <StatCard label="Last 10" value={`${last_10.wins}–${last_10.losses}`} />
      <StatCard
        label="Net Rtg"
        value={net_rating != null ? `${net_rating > 0 ? '+' : ''}${net_rating.toFixed(1)}` : '—'}
        positive={net_rating != null ? net_rating > 0 : undefined}
      />
      <StatCard
        label="Off Rtg"
        value={off_rating != null ? off_rating.toFixed(1) : '—'}
      />
      <StatCard
        label="Def Rtg"
        value={def_rating != null ? def_rating.toFixed(1) : '—'}
      />
    </div>
    </div>
  )
}
