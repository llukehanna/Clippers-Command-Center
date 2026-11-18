'use client'

import { usePathname } from 'next/navigation'
import { SegmentedLinks } from '@/components/ui/segmented-links'
import { FRANCHISE_TABS, franchiseTab } from '@/src/lib/franchise/display'

/** The six Franchise tabs. On phones the row scrolls (SegmentedLinks keeps the active tab in view). */
export function FranchiseTabs() {
  const pathname = usePathname() ?? '/franchise'
  const value = franchiseTab(pathname)
  return (
    <div className="enter min-w-0" style={{ ['--i' as string]: 1 }}>
      <SegmentedLinks ariaLabel="Franchise sections" value={value} options={FRANCHISE_TABS.map((t) => ({ ...t }))} />
    </div>
  )
}
