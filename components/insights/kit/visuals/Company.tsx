import { cn } from '@/lib/utils'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { surname } from '@/src/lib/insights/kit-geometry'
import type { CardVisual } from '@/src/lib/insights/visual'

type CompanyVisual = Extract<CardVisual, { kind: 'company' }>

/**
 * The only others to do it, then him (insights.css:119-123). Initials avatars
 * for everyone: proof rows carry internal ids, not NBA person ids (ruling 14).
 */
export function Company({ visual }: { visual: CompanyVisual }) {
  return (
    <div role="img" aria-label={visual.aria} className="flex flex-wrap items-center gap-2">
      {visual.members.map((m) => (
        <span
          key={`${m.name}-${m.date}`}
          className={cn(
            'flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5',
            m.me
              ? 'bg-[rgba(65,143,222,0.14)] shadow-[inset_0_0_0_1px_rgba(65,143,222,0.4)]'
              : 'bg-white/[0.035] shadow-[inset_0_0_0_1px_var(--line)]',
          )}
        >
          <PlayerAvatar name={m.name} nbaPlayerId={null} size={24} />
          <span>
            <span className="whitespace-nowrap text-[12px] text-text">{surname(m.name)}</span>
            <br />
            <span className="whitespace-nowrap font-mono text-[10px] text-dim">{m.date}</span>
          </span>
        </span>
      ))}
    </div>
  )
}
