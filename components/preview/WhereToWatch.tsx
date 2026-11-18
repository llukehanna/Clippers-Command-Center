import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Chip } from '@/components/ui/chip'
import { teamName } from '@/src/lib/ui/teams'
import type { Broadcast } from '@/src/lib/ui/types'

const GROUPS = ['national', 'clippers', 'opponent'] as const

/** Networks by audience, plus the game's calendar file (always shown). */
export function WhereToWatch({ gameId, broadcasts, oppAbbr }: { gameId: string; broadcasts: Broadcast[] | null; oppAbbr: string }) {
  const groups = GROUPS.map((group) => ({ group, items: (broadcasts ?? []).filter((b) => b.group === group) })).filter((g) => g.items.length)
  const label = (group: (typeof GROUPS)[number]) => (group === 'national' ? 'National' : group === 'clippers' ? 'Clippers' : teamName(oppAbbr))
  return (
    <Panel className="h-full p-5">
      <Eyebrow
        aside={
          <a href={`/schedule/${gameId}/ics`} className="font-mono text-[11.5px] text-mute transition-colors hover:text-text">
            Add to calendar ↓
          </a>
        }
      >
        Where to watch
      </Eyebrow>
      {groups.length ? (
        <dl className="m-0 grid gap-3">
          {groups.map(({ group, items }) => (
            <div key={group} className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-3">
              <dt className="pt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-dim">{label(group)}</dt>
              <dd className="m-0 flex flex-wrap gap-1.5">
                {items.map((b) => (
                  <Chip key={b.name} tone={group === 'clippers' ? 'blue' : 'default'}>
                    {b.name}
                    {b.kind === 'streaming' ? ' · stream' : ''}
                  </Chip>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 text-[13.5px] text-mute">Broadcast details aren&apos;t posted yet.</p>
      )}
    </Panel>
  )
}
