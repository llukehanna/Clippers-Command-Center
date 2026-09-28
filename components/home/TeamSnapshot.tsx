// components/home/TeamSnapshot.tsx
// Server Component — renders five stat cards for the team snapshot row.

import { StatCard } from '@/components/stat-card/StatCard'

interface TeamSnapshotProps {
  snapshot: {
    record: { wins: number; losses: number }
    last_10: { wins: number; losses: number }
    net_rating: number | null
    off_rating: number | null
    def_rating: number | null
  }
}

export function TeamSnapshot({ snapshot }: TeamSnapshotProps) {
  const { record, last_10, net_rating, off_rating, def_rating } = snapshot

  return (
    <div className="grid grid-cols-5 gap-3">
      <StatCard label="Record" value={`${record.wins}–${record.losses}`} />
      <StatCard label="Last 10" value={`${last_10.wins}–${last_10.losses}`} />
      <StatCard
        label="Net Rtg"
        value={net_rating != null ? net_rating.toFixed(1) : '—'}
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
  )
}
