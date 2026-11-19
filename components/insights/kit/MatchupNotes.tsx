import { PlayerAvatar } from '@/components/ui/player-avatar'
import type { MatchupNote } from '@/src/lib/insights/card'

/** Pregame context lines (insights.css:175-180): icon tile or headshot, the line, a short aside. */
export function MatchupNotes({ notes }: { notes: MatchupNote[] }) {
  if (notes.length === 0) return null
  return (
    <ul className="grid divide-y divide-line">
      {notes.map((n) => (
        <li
          key={n.insight_id}
          className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2.5 px-0.5 py-[9px] text-[13px] text-mute"
        >
          {n.player ? (
            <PlayerAvatar name={n.player.name} nbaPlayerId={n.player.nba_person_id} size={22} />
          ) : (
            <span
              aria-hidden
              className="grid size-[22px] place-items-center rounded-[7px] bg-white/[0.04] font-mono text-[10px] text-dim"
            >
              {n.icon}
            </span>
          )}
          <span className="min-w-0">{n.text}</span>
          <span className="whitespace-nowrap font-mono text-[11px] text-dim">{n.aside}</span>
        </li>
      ))}
    </ul>
  )
}
