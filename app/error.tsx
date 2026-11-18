'use client'

import { useEffect } from 'react'
import { StatusPage } from '@/components/shell/StatusPage'

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <StatusPage code="500" title="Something went wrong" body="This page hit an error while loading. Trying again usually fixes it.">
      <button
        type="button"
        onClick={() => retry()}
        className="press glass-track inline-flex h-11 items-center rounded-full px-5 text-[14.5px] text-text transition-colors hover:text-white"
      >
        Try again
      </button>
    </StatusPage>
  )
}
