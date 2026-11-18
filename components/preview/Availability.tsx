import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Chip, type ChipTone } from '@/components/ui/chip'
import { TeamLogo } from '@/components/ui/team-mark'
import { ageLabel, formatDayShort } from '@/src/lib/ui/time'
import { teamName } from '@/src/lib/ui/teams'
import type { InjuryEntry } from '@/src/lib/ui/types'

const tone = (status: string): ChipTone => {
  const s = status.toLowerCase()
  if (s === 'out') return 'neg'
  if (s === 'doubtful' || s === 'questionable' || s === 'day-to-day') return 'warn'
  return 'default'
}

function TeamList({ abbr, label, entries }: { abbr: string; label: string; entries: InjuryEntry[] }) {
  return (
    <Panel className="p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <TeamLogo abbr={abbr} size="sm" />
        <span className="text-[14.5px] font-medium tracking-[-0.01em]">{label}</span>
      </div>
      {entries.length ? (
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {entries.map((e) => (
            <li key={e.name} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[14px]">{e.name}</div>
                <div className="font-mono text-[11.5px] text-dim">
                  {e.injury ?? 'Undisclosed'}
                  {e.return_date ? ` · est. return ${formatDayShort(e.return_date)}` : ''}
                </div>
              </div>
              <Chip tone={tone(e.status)}>{e.status}</Chip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13.5px] text-mute">No injuries reported.</p>
      )}
    </Panel>
  )
}

export function Availability({ injuries, oppAbbr }: { injuries: { updated_at: string | null; lac: InjuryEntry[]; opp: InjuryEntry[] }; oppAbbr: string }) {
  const age = ageLabel(injuries.updated_at)
  return (
    <section aria-label="Availability">
      <Eyebrow aside={`${age ? `updated ${age} ago · ` : ''}via ESPN`}>Availability</Eyebrow>
      <div className="grid gap-3 md:grid-cols-2">
        <TeamList abbr="LAC" label="Clippers" entries={injuries.lac} />
        <TeamList abbr={oppAbbr} label={teamName(oppAbbr)} entries={injuries.opp} />
      </div>
    </section>
  )
}
