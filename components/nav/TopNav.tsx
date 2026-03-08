'use client'

import { usePathname } from 'next/navigation'
import { NavLinks } from './NavLinks'

export function TopNav() {
  const pathname = usePathname()

  // Hide the legacy app nav on /live (and /live/prototype) so the page
  // uses its own centered floating navigation bar.
  if (pathname.startsWith('/live')) {
    return null
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-12 border-b border-border-subtle bg-background/80 backdrop-blur-md">
      <div className="flex h-full items-center gap-6 px-6">
        <span className="text-[0.8125rem] font-bold tracking-widest text-foreground select-none">
          CCC
        </span>
        <NavLinks />
      </div>
    </header>
  )
}
