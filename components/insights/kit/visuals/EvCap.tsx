import * as React from 'react'

/** Visual caption row (insights.css:92-93). Wrap emphasised values in <b>. */
export function EvCap({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mt-1.5 flex justify-between gap-2.5 font-mono text-[10.5px] text-dim [&_b]:font-mono [&_b]:font-medium [&_b]:text-text">
      <span>{left}</span>
      {right != null && <span className="text-right">{right}</span>}
    </div>
  )
}
