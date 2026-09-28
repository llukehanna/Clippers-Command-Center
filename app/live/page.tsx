'use client'

import { useLiveData } from '@/hooks/useLiveData'
import { LiveView } from '@/components/live/LiveView'

export default function LivePage() {
  const { data, error } = useLiveData({ follow: 'cadence' })
  return <LiveView data={data} error={error} />
}
