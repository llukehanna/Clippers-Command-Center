'use client'

import React from 'react'
import { Surface } from '@/components/ui/surface'
import { NavLinkCapsule } from '@/components/ui/nav-link-capsule'
import { TeamLogoWithAbbr } from '@/components/ui/team-logo'

// ---------------------------------------------------------------------------
// Placeholder data (visual prototype only — no backend)
// ---------------------------------------------------------------------------

const SCOREBOARD = {
  away: { abbr: 'LAC', slug: 'lac' as const, score: 103, isClippers: true },
  home: { abbr: 'LAL', slug: 'lal' as const, score: 103, isClippers: false },
  period: 4,
  clock: '4:05',
  status: 'Live',
  analyticsStrip: [
    { label: 'PACE', value: '+4' },
    { label: 'REB', value: '-6' },
    { label: 'FT', value: '+7' },
    { label: 'eFG', value: '+1.9' },
  ],
}

const METRICS = [
  { label: 'eFG%', value: '54.2%', support: 'LAC 52.1% · LAL 50.3%' },
  { label: 'TO MARGIN', value: '+2', support: 'Clippers 8 · Lakers 10' },
  { label: 'REB MARGIN', value: '-6', support: 'LAC 38 · LAL 44' },
  { label: 'PACE', value: '98.4', support: 'Possessions per 48' },
  { label: 'FT EDGE', value: '+7', support: 'LAC 13–17 · LAL 6–10' },
  { label: 'FOUL PRESSURE', value: 'High', support: 'LAL in penalty' },
]

const INSIGHTS = [
  {
    category: 'Clutch',
    headline: 'Q4, 4:05 remaining, score tied',
    support: 'Lakers +6 rebounds — key to staying even.',
  },
  {
    category: 'Hot hand',
    headline: 'Kawhi Leonard 8-for-11 since halftime',
    support: '18 pts in second half.',
  },
  {
    category: 'Context',
    headline: 'Both teams above league avg eFG%',
    support: 'Shooting 52%+ tonight.',
  },
]

const BOX_SCORE_ROWS = [
  { name: 'K. Leonard', min: 32, pts: 28, reb: 6, ast: 4, stl: 2, blk: 0, to: 1, fg: '10-18', three: '2-5', ft: '6-6', plusMinus: 5 },
  { name: 'J. Harden', min: 34, pts: 22, reb: 4, ast: 10, stl: 1, blk: 0, to: 3, fg: '7-14', three: '4-8', ft: '4-4', plusMinus: 2 },
  { name: 'P. George', min: 30, pts: 18, reb: 5, ast: 3, stl: 0, blk: 1, to: 2, fg: '6-15', three: '2-6', ft: '4-5', plusMinus: -3 },
  { name: 'I. Zubac', min: 28, pts: 14, reb: 12, ast: 1, stl: 0, blk: 2, to: 1, fg: '6-9', three: '0-0', ft: '2-2', plusMinus: 4 },
  { name: 'N. Powell', min: 24, pts: 12, reb: 2, ast: 2, stl: 1, blk: 0, to: 0, fg: '4-9', three: '2-4', ft: '2-2', plusMinus: 6 },
  { name: 'N. Batum', min: 18, pts: 5, reb: 3, ast: 2, stl: 0, blk: 0, to: 0, fg: '2-4', three: '1-3', ft: '0-0', plusMinus: -2 },
  { name: 'M. Plumlee', min: 12, pts: 4, reb: 4, ast: 1, stl: 0, blk: 0, to: 1, fg: '2-3', three: '0-0', ft: '0-0', plusMinus: -1 },
]

// ---------------------------------------------------------------------------
// Live Prototype — single component, no data fetching
// ---------------------------------------------------------------------------
export default function LivePrototype() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 1. Centered floating nav — elevated, liquid-glass, above page */}
      <header className="pt-8 pb-4">
        <Surface variant="nav" className="relative mx-auto flex max-w-max items-center gap-6 px-6 py-2.5">
          <span className="text-[0.875rem] font-bold tracking-widest text-foreground">
            CCC
          </span>
          <nav className="flex items-center gap-0.5" aria-label="Main">
            <NavLinkCapsule href="/">Home</NavLinkCapsule>
            <NavLinkCapsule href="/live" active>Live</NavLinkCapsule>
            <NavLinkCapsule href="/players">Players</NavLinkCapsule>
            <NavLinkCapsule href="/schedule">Schedule</NavLinkCapsule>
            <NavLinkCapsule href="/history">History</NavLinkCapsule>
          </nav>
        </Surface>
      </header>

      <main className="mx-auto max-w-[1440px] px-6 pb-12">
        {/* 2. Scoreboard hero — frosted glass, premium module, clear layer below nav */}
        <section className="mt-6" aria-label="Scoreboard">
          <Surface variant="scoreboard" className="relative px-8 py-8">
          <div className="relative flex items-center justify-between gap-8">
            {/* Away (LAC): logo + abbr below, score beside */}
            <div className="flex items-center gap-6">
              <TeamLogoWithAbbr abbr={SCOREBOARD.away.abbr} slug={SCOREBOARD.away.slug} />
              <span className="ccc-hero-stat">
                {SCOREBOARD.away.score}
              </span>
            </div>

            {/* Center: hierarchy 1. score (implied) 2. clock 3. quarter; LIVE with red dot */}
            <div className="flex flex-col items-center gap-2 rounded-xl border border-border-subtle bg-white/[0.04] px-5 py-3 backdrop-blur-md shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]">
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                {SCOREBOARD.clock}
              </span>
              <span className="ccc-section-title">
                Q{SCOREBOARD.period}
              </span>
              <span className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-primary">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                {SCOREBOARD.status}
              </span>
            </div>

            {/* Home (LAL): score beside logo + abbr below */}
            <div className="flex items-center gap-6">
              <span className="ccc-hero-stat">
                {SCOREBOARD.home.score}
              </span>
              <TeamLogoWithAbbr abbr={SCOREBOARD.home.abbr} slug={SCOREBOARD.home.slug} />
            </div>
          </div>

          {/* Analytics strip */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-border-subtle pt-4 text-[0.75rem] text-muted-foreground">
            {SCOREBOARD.analyticsStrip.map((item, i) => (
              <span key={item.label} className="flex items-center gap-x-6">
                <span>
                  <span className="font-semibold uppercase tracking-wider">
                    {item.label}
                  </span>{' '}
                  <span className="tabular-nums">{item.value}</span>
                </span>
                {i < SCOREBOARD.analyticsStrip.length - 1 && (
                  <span className="text-white/[0.2]">|</span>
                )}
              </span>
            ))}
          </div>
          </Surface>
        </section>

        {/* 3. Metric cards — clear layer, tactile hover */}
        <section className="mt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {METRICS.map((m) => (
              <Surface key={m.label} variant="card" hover className="px-4 py-3">
                <p className="ccc-card-label text-muted-foreground/90">
                  {m.label}
                </p>
                <p className="mt-1.5 text-[1.75rem] font-bold tabular-nums leading-none tracking-[-0.03em] text-foreground">
                  {m.value}
                </p>
                <p className="mt-1 text-[0.75rem] leading-none text-muted-foreground">
                  {m.support}
                </p>
              </Surface>
            ))}
          </div>
        </section>

        {/* 4 & 5. Main content: box score (8) + insights sidebar (4) */}
        <div className="mt-8 grid grid-cols-12 gap-6">
          {/* Box score */}
          <div className="col-span-12 lg:col-span-8">
            <h2 className="ccc-section-title mb-3">
              Box score
            </h2>
            <Surface variant="card" className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left">
                  <thead className="sticky top-0 z-10 border-b border-border-strong bg-surface-alt">
                    <tr>
                      <th className="ccc-table-meta px-3 py-2.5 text-left">
                        Player
                      </th>
                      {['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', '3PT', 'FT', '+/-'].map(
                        (col) => (
                          <th
                            key={col}
                            className="ccc-table-meta px-3 py-2.5 text-right"
                          >
                            {col}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {BOX_SCORE_ROWS.map((row) => (
                      <tr
                        key={row.name}
                        className="h-9 border-b border-border-subtle transition-all duration-150 last:border-0 hover:bg-white/[0.06]"
                      >
                        <td className="ccc-body px-3 py-2 font-medium">
                          {row.name}
                        </td>
                        <td className="ccc-body px-3 py-2 text-right tabular-nums">
                          {row.min}
                        </td>
                        <td className="ccc-body px-3 py-2 text-right tabular-nums">
                          {row.pts}
                        </td>
                        <td className="ccc-body px-3 py-2 text-right tabular-nums">
                          {row.reb}
                        </td>
                        <td className="ccc-body px-3 py-2 text-right tabular-nums">
                          {row.ast}
                        </td>
                        <td className="ccc-body px-3 py-2 text-right tabular-nums">
                          {row.stl}
                        </td>
                        <td className="ccc-body px-3 py-2 text-right tabular-nums">
                          {row.blk}
                        </td>
                        <td className="ccc-body px-3 py-2 text-right tabular-nums">
                          {row.to}
                        </td>
                        <td className="ccc-body px-3 py-2 text-right tabular-nums">
                          {row.fg}
                        </td>
                        <td className="ccc-body px-3 py-2 text-right tabular-nums">
                          {row.three}
                        </td>
                        <td className="ccc-body px-3 py-2 text-right tabular-nums">
                          {row.ft}
                        </td>
                        <td className="ccc-body px-3 py-2 text-right tabular-nums">
                          {row.plusMinus > 0 ? `+${row.plusMinus}` : row.plusMinus}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Surface>
          </div>

          {/* Insights feed */}
          <div className="col-span-12 lg:col-span-4">
            <h2 className="ccc-section-title mb-3">
              Insights
            </h2>
            <Surface variant="card" className="p-5">
              <div className="flex flex-col gap-6">
                {INSIGHTS.map((insight, i) => (
                  <div
                    key={i}
                    className="ccc-hover-card min-h-[4rem] rounded-lg border border-transparent px-3 py-2 -mx-1 border-b border-border-subtle pb-6 last:border-0 last:pb-0 last:pt-0 first:pt-0"
                  >
                    <p className="ccc-section-title text-primary">
                      {insight.category}
                    </p>
                    <p className="mt-1 text-[0.875rem] font-medium leading-snug text-foreground">
                      {insight.headline}
                    </p>
                    <p className="mt-0.5 text-[0.75rem] leading-snug text-muted-foreground">
                      {insight.support}
                    </p>
                  </div>
                ))}
              </div>
            </Surface>
          </div>
        </div>
      </main>
    </div>
  )
}
