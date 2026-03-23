'use client'

import { usePathname } from 'next/navigation'
import { Surface } from '@/components/ui/surface'
import { NavLinkCapsule } from '@/components/ui/nav-link-capsule'

export function TopNav() {
  const pathname = usePathname()
  const isLive = pathname === '/live' || pathname.startsWith('/live/')

  return (
    <header className="pt-8 pb-4">
      <Surface variant="nav" className="relative mx-auto flex max-w-max items-center gap-6 px-6 py-2.5">
        <span className="text-[0.875rem] font-bold tracking-widest text-foreground">CCC</span>
        <nav className="flex items-center gap-0.5" aria-label="Main">
          <NavLinkCapsule href="/home" active={pathname === '/home'}>
            Home
          </NavLinkCapsule>
          <NavLinkCapsule href="/live" active={isLive}>
            Live
          </NavLinkCapsule>
          <NavLinkCapsule href="/players" active={pathname.startsWith('/players')}>
            Players
          </NavLinkCapsule>
          <NavLinkCapsule href="/schedule" active={pathname.startsWith('/schedule')}>
            Schedule
          </NavLinkCapsule>
          <NavLinkCapsule href="/history" active={pathname.startsWith('/history')}>
            History
          </NavLinkCapsule>
        </nav>
      </Surface>
    </header>
  )
}
