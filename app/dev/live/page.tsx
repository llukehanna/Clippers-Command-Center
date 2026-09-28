import { notFound } from 'next/navigation'
import { DevLiveClient } from './DevLiveClient'

// Dev-only: the Live view rendered from a fixture payload.
export default function DevLivePage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <DevLiveClient />
}
