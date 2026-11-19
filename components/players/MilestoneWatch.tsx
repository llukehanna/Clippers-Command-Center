import { Panel } from '@/components/ui/panel'
import { MilestoneBar } from '@/components/insights/kit/visuals/MilestoneBar'
import type { PlayerDetailPayload } from '@/src/lib/ui/types'

type Item = PlayerDetailPayload['milestones'][number]

/** Milestones within reach (insights.css .watch): headline over the progress bar, whose caption says "{remaining} to go" (once). */
export function MilestoneWatch({ items }: { items: Item[] }) {
  const open = items.filter((m) => m.target > m.current)
  if (open.length === 0) return null
  return (
    <Panel className="grid gap-4 px-[18px] py-4">
      {open.map((m) => (
        <div key={m.insight_id} className="grid gap-2.5">
          <span className="text-[14px] font-medium">{m.headline}</span>
          <MilestoneBar
            evidence={{ type: 'milestone_progress', current: m.current, target: m.target, label: m.label }}
            aria={`${m.headline}: ${m.current.toLocaleString('en-US')} of ${m.target.toLocaleString('en-US')} ${m.label}`}
          />
        </div>
      ))}
    </Panel>
  )
}
