import * as React from 'react'

interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}

/** Page title row: large heading, one quiet line of context, optional controls. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="m-0 text-[30px] font-semibold leading-tight tracking-[-0.035em] sm:text-[36px]">{title}</h1>
        {subtitle && <p className="m-0 mt-1.5 text-[14.5px] text-mute">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
