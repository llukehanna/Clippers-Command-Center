'use client'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface ChartEntry {
  label: string
  margin: number
}

interface PointDiffTooltipProps {
  active?: boolean
  payload?: Array<{ value: number; payload: ChartEntry }>
}

function PointDiffTooltip({ active, payload }: PointDiffTooltipProps) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  const margin = entry.value
  return (
    <div className="rounded-lg border border-white/[0.06] bg-surface-alt px-3 py-2 text-[0.8125rem]">
      <p className="font-medium text-foreground">{entry.payload.label}</p>
      <p className={margin >= 0 ? 'text-positive' : 'text-negative'}>
        {margin >= 0 ? `+${margin}` : margin}
      </p>
    </div>
  )
}

interface Game {
  opponent_abbr: string
  game_date: string
  margin: number
}

export function PointDiffChart({ games }: { games: Game[] }) {
  if (!games?.length) return null

  const data: ChartEntry[] = games.map((g) => ({
    label: g.opponent_abbr,
    margin: g.margin,
  }))

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Last 10 Games — Point Differential</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="" stroke="var(--border)" strokeOpacity={0.08} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<PointDiffTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />
          <Bar dataKey="margin" radius={[2, 2, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.margin >= 0 ? 'var(--chart-2)' : 'var(--chart-4)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
