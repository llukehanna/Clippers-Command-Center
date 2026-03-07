import { NavLinks } from './NavLinks'

export function TopNav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-12 border-b border-white/[0.06] bg-background/80 backdrop-blur-md">
      <div className="flex h-full items-center gap-6 px-6">
        <span className="text-[0.8125rem] font-bold tracking-widest text-foreground select-none">
          CCC
        </span>
        <NavLinks />
      </div>
    </header>
  )
}
