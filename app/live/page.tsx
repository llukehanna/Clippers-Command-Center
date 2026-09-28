'use client'

import { useLiveData } from '@/hooks/useLiveData'
import { LiveView } from '@/components/live/LiveView'

export default function LivePage() {
  const { data, error } = useLiveData()
  return <LiveView data={data} error={error} />
}
