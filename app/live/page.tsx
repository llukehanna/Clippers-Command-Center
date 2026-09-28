'use client'

import { useLiveStream } from '@/hooks/useLiveStream'
import { LiveView } from '@/components/live/LiveView'
import { LatencyOverlay } from '@/components/live/LatencyOverlay'

export default function LivePage() {
  const { data, error, source, latency } = useLiveStream()
  return (
    <>
      <LiveView data={data} error={error} source={source} />
      <LatencyOverlay sample={latency} />
    </>
  )
}
