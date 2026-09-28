'use client'

import * as React from 'react'

/** False once the tab has been hidden for `graceMs`; true again as soon as it's visible. */
export function useVisibleWithGrace(graceMs: number): boolean {
  const [visible, setVisible] = React.useState(true)
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') setVisible(true)
      else timer = setTimeout(() => setVisible(false), graceMs)
    }
    document.addEventListener('visibilitychange', onChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onChange)
    }
  }, [graceMs])
  return visible
}
