import * as React from 'react'
import Link from 'next/link'
import { TeamLogo } from '@/components/ui/team-mark'

/** Full-page message for 404s and crashes, in the app's glass style. */
export function StatusPage({ code, title, body, children }: { code: string; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="page">
      <section className="panel panel-hero enter relative mx-auto mt-[6vh] w-full max-w-[640px] overflow-hidden px-6 py-12 text-center sm:px-10 sm:py-14">
        <span aria-hidden className="hero-glow" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-2 select-none text-center text-[148px] font-semibold leading-none tracking-[-0.06em] text-white/[0.035] sm:text-[188px]"
        >
          {code}
        </span>
        <div className="relative flex flex-col items-center">
          <TeamLogo abbr="LAC" size="lg" priority />
          <p className="label-mono mt-6 !text-mute">{code === '404' ? 'Page not found' : 'Error'}</p>
          <h1 className="m-0 mt-2 text-[28px] font-semibold leading-tight sm:text-[34px]">{title}</h1>
          <p className="m-0 mt-3 max-w-[44ch] text-[15px] text-mute">{body}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
            {children}
            <Link
              href="/home"
              className="press lens inline-flex h-11 items-center rounded-full px-5 text-[14.5px] font-medium text-white"
            >
              Back to Home
            </Link>
            <Link
              href="/schedule"
              className="press glass-track inline-flex h-11 items-center rounded-full px-5 text-[14.5px] text-mute transition-colors hover:text-text"
            >
              Schedule
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
