import { NavLinks } from './NavLinks'

export function TopNav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center gap-8 px-6">
        {/* Wordmark */}
        <span className="text-sm font-bold tracking-wider text-foreground select-none">
          CCC
        </span>
        {/* Nav links with live dot embedded in Live link */}
        <NavLinks />
      </div>
    </header>
  )
}
