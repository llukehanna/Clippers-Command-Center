import * as React from 'react'
import { SPARK_H, SPARK_W, sparkGeometry } from '@/src/lib/insights/kit-geometry'
import type { Evidence } from '@/src/lib/insights/types'
import { EvCap } from './EvCap'

type SparkEvidence = Extract<Evidence, { type: 'margin_spark' }>

/** Score margin over the game, green above zero and red below (insights.css:172; insights.js:147-166). */
export function MarginSpark({ evidence, aria }: { evidence: SparkEvidence; aria: string }) {
  // Unique per instance; stripped to characters that are safe inside url(#…).
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const g = sparkGeometry(evidence.series, evidence.highlight)
  if (!g) return null
  const up = `spark-up-${uid}`
  const dn = `spark-dn-${uid}`
  return (
    <div role="img" aria-label={aria}>
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        aria-hidden
        className="block h-14 w-full overflow-visible"
      >
        <defs>
          <clipPath id={up}>
            <rect x="0" y="0" width={SPARK_W} height={g.mid} />
          </clipPath>
          <clipPath id={dn}>
            <rect x="0" y={g.mid} width={SPARK_W} height={g.mid} />
          </clipPath>
        </defs>
        {g.highlight && (
          <rect x={g.highlight.x} y="0" width={g.highlight.width} height={SPARK_H} fill="rgba(65,143,222,0.12)" rx="3" />
        )}
        <line x1="0" x2={SPARK_W} y1={g.mid} y2={g.mid} stroke="rgba(150,178,230,0.25)" strokeDasharray="3 3" />
        <path d={g.area} fill="rgba(76,195,138,0.22)" clipPath={`url(#${up})`} />
        <path d={g.area} fill="rgba(240,103,122,0.2)" clipPath={`url(#${dn})`} />
        <path d={g.line} fill="none" stroke="#cfe3f8" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      </svg>
      <EvCap left="Tip" right="Final" />
    </div>
  )
}
