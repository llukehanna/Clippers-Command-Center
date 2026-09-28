import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { DivergingBars } from '@/components/charts/DivergingBars'
import { formatSigned } from '@/src/lib/ui/odds'
import { formatDayShort } from '@/src/lib/ui/time'

interface LastTenPanelProps {
  games: Array<{ opponent_abbr: string; game_date: string; margin: number; game_id?: string }>
}

/** Point differential of the last ten games, oldest to newest. */
export function LastTenPanel({ games }: LastTenPanelProps) {
  const sorted = [...games].sort((a, b) => a.game_date.localeCompare(b.game_date))
  if (sorted.length === 0) return null
  const wins = sorted.filter((g) => g.margin > 0).length
  const avg = sorted.reduce((s, g) => s + g.margin, 0) / sorted.length
  const best = sorted.reduce((b, g) => (g.margin > b.margin ? g : b), sorted[0])
  const range = `${formatDayShort(sorted[0].game_date)} – ${formatDayShort(sorted.at(-1)!.game_date)}`

  return (
    <Panel className="p-5 sm:p-6">
      <Eyebrow aside={range}>Last 10</Eyebrow>
      <DivergingBars
        data={sorted.map((g) => ({
          key: `${g.game_date}-${g.opponent_abbr}`,
          label: g.opponent_abbr,
          value: g.margin,
          href: g.game_id ? `/history/${g.game_id}` : undefined,
          title: `${g.margin > 0 ? 'W' : 'L'} ${formatSigned(g.margin)} vs ${g.opponent_abbr} · ${formatDayShort(g.game_date)}`,
        }))}
      />
      <div className="mt-3 flex flex-wrap justify-between gap-2 font-mono text-[11.5px] text-mute tabular-nums">
        <span>
          {wins}–{sorted.length - wins} · avg {formatSigned(avg, 1)}
        </span>
        {best.margin > 0 && (
          <span>
            Best: {formatSigned(best.margin)} vs {best.opponent_abbr}
          </span>
        )}
      </div>
    </Panel>
  )
}
