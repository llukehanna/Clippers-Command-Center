import { Panel } from '@/components/ui/panel'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { TeamLogo } from '@/components/ui/team-mark'
import { Stat } from '@/components/ui/stat'
import { formatSigned } from '@/src/lib/ui/odds'
import { positionLabel } from './RosterGrid'
import { headshotUrl, initials } from '@/src/lib/ui/headshot'

interface Averages {
  pts_avg: number | null
  reb_avg: number | null
  ast_avg: number | null
  ts_pct: number | null
}

interface PlayerHeroProps {
  name: string
  position: string | null
  nbaPlayerId: string | null
  seasonLabel: string
  gamesPlayed: number
  season: Averages | null
  recent: (Averages & { window_games: number }) | null
}

function stat(label: string, key: keyof Averages, season: Averages | null, recent: Averages | null, pct = false) {
  const s = season?.[key] ?? null
  const r = recent?.[key] ?? null
  const scale = pct ? 100 : 1
  const delta = s != null && r != null ? (r - s) * scale : null
  return (
    <Stat
      key={label}
      label={label}
      size="lg"
      value={s == null ? '—' : (s * scale).toFixed(1)}
      sub={delta == null ? 'season avg' : `L10 ${formatSigned(delta, 1)}`}
      subTone={delta == null || Math.abs(delta) < 0.05 ? 'mute' : delta > 0 ? 'pos' : 'neg'}
    />
  )
}

/** Headshot, name and the four headline averages (season, with L10 change). */
export function PlayerHero({ name, position, nbaPlayerId, seasonLabel, gamesPlayed, season, recent }: PlayerHeroProps) {
  // Without a usable headshot, drop the photo column for a monogram beside the name.
  const hasPhoto = headshotUrl(nbaPlayerId) != null
  return (
    <Panel
      variant="hero"
      className={hasPhoto ? 'grid grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]' : 'overflow-hidden'}
    >
      {hasPhoto && (
        <div className="relative">
          <PlayerAvatar name={name} nbaPlayerId={nbaPlayerId} variant="hero" priority className="h-full min-h-[220px]" />
          <TeamLogo abbr="LAC" size="md" className="absolute left-4 top-4 opacity-90" />
        </div>
      )}
      <div className="relative flex flex-col justify-between gap-7 p-5 sm:p-7">
        <div className={hasPhoto ? '' : 'flex items-center gap-5'}>
          {!hasPhoto && (
            <span
              aria-hidden
              className="relative grid h-[76px] w-[76px] shrink-0 place-items-center rounded-full border border-line-2 bg-[radial-gradient(circle_at_30%_20%,#1a3a69,#0c2340)] text-[26px] font-semibold tracking-[-0.03em] sm:h-[92px] sm:w-[92px] sm:text-[30px]"
            >
              {initials(name)}
              <TeamLogo abbr="LAC" size="xs" className="absolute -bottom-0.5 -right-0.5" />
            </span>
          )}
          <div className="min-w-0">
            <p className="label-mono !text-mute">
              {positionLabel(position)} · {seasonLabel}
            </p>
            <h1 className="m-0 mt-2 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[44px]">{name}</h1>
            <p className="m-0 mt-2 font-mono text-[12px] text-mute">
              {gamesPlayed} games logged
              {recent ? ` · last ${recent.window_games} compared to season` : ''}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          {stat('Points', 'pts_avg', season, recent)}
          {stat('Rebounds', 'reb_avg', season, recent)}
          {stat('Assists', 'ast_avg', season, recent)}
          {stat('True shooting', 'ts_pct', season, recent, true)}
        </div>
      </div>
    </Panel>
  )
}
