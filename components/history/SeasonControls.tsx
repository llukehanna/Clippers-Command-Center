'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface SeasonControlsProps {
  seasons: Array<{ season_id: number; label: string }>
  currentSeasonId: string
}

export function SeasonControls({ seasons, currentSeasonId }: SeasonControlsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function navigate(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === null) {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    router.push('/history?' + params.toString())
  }

  function onSeasonChange(seasonId: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('season_id', seasonId)
    params.delete('home_away')
    params.delete('result')
    router.push('/history?' + params.toString())
  }

  const currentHomeAway = searchParams.get('home_away')
  const currentResult = searchParams.get('result')

  return (
    <div className="sticky top-14 z-20 flex items-center gap-3 py-3 px-0 bg-background/80 backdrop-blur-md border-b border-white/[0.06]">
      {/* Season dropdown */}
      <select
        value={currentSeasonId}
        onChange={(e) => onSeasonChange(e.target.value)}
        className="bg-surface border border-white/[0.08] text-foreground text-sm rounded-lg px-3 py-1.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-white/20"
      >
        {seasons.map((s) => (
          <option key={s.season_id} value={String(s.season_id)}>
            {s.label}
          </option>
        ))}
      </select>

      {/* H/A segmented buttons */}
      <div className="inline-flex rounded-lg border border-white/[0.08] overflow-hidden">
        {(['all', 'home', 'away'] as const).map((opt) => {
          const value = opt === 'all' ? null : opt
          const isActive = (currentHomeAway ?? null) === value
          return (
            <button
              key={opt}
              onClick={() => navigate('home_away', value)}
              className={[
                'px-3 py-1.5 text-sm transition-colors duration-150',
                isActive
                  ? 'bg-white/[0.1] text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]',
              ].join(' ')}
            >
              {opt === 'all' ? 'All' : opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          )
        })}
      </div>

      {/* W/L segmented buttons */}
      <div className="inline-flex rounded-lg border border-white/[0.08] overflow-hidden">
        {(['all', 'W', 'L'] as const).map((opt) => {
          const value = opt === 'all' ? null : opt
          const isActive = (currentResult ?? null) === value
          return (
            <button
              key={opt}
              onClick={() => navigate('result', value)}
              className={[
                'px-3 py-1.5 text-sm transition-colors duration-150',
                isActive
                  ? 'bg-white/[0.1] text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]',
              ].join(' ')}
            >
              {opt === 'all' ? 'All' : opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}
