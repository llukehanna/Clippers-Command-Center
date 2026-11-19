import { fmtNum, milestoneBar } from '@/src/lib/insights/kit-geometry'
import type { Evidence } from '@/src/lib/insights/types'
import { EvCap } from './EvCap'

type MilestoneEvidence = Extract<Evidence, { type: 'milestone_progress' }>

/** Progress to a round number (insights.css:168-169; insights.js:141-146). Right label: "{remaining} to go". */
export function MilestoneBar({ evidence, aria }: { evidence: MilestoneEvidence; aria: string }) {
  const m = milestoneBar(evidence.current, evidence.target)
  if (!m) return null
  return (
    <div role="img" aria-label={aria}>
      <div className="relative h-2.5 overflow-hidden rounded-[5px] bg-[rgba(150,178,230,0.14)]">
        <i
          className="absolute inset-y-0 left-0 rounded-[5px] bg-[linear-gradient(90deg,rgba(227,179,65,0.45),var(--warn))] shadow-[0_0_14px_rgba(227,179,65,0.6)]"
          style={{ width: `${m.pct}%` }}
        />
      </div>
      <EvCap
        left={
          <>
            <b>{fmtNum(evidence.current)}</b> {evidence.label}
          </>
        }
        right={m.remaining > 0 ? `${fmtNum(m.remaining)} to go` : null}
      />
    </div>
  )
}
