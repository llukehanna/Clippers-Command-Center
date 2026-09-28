'use client'

import { useRouter } from 'next/navigation'

/** Season picker; changing season clears the other filters. */
export function SeasonSelect({ seasons, value }: { seasons: Array<{ season_id: number; label: string }>; value: string }) {
  const router = useRouter()
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Season</span>
      <select
        value={value}
        onChange={(e) => router.push(`/history?season_id=${e.target.value}`, { scroll: false })}
        className="cursor-pointer appearance-none rounded-full border border-line bg-white/[0.025] py-1.5 pl-3.5 pr-8 text-[13.5px] text-text outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-pacific"
      >
        {[...seasons].reverse().map((s) => (
          <option key={s.season_id} value={String(s.season_id)} className="bg-ink-2">
            {s.label.replace('-', '–')}
          </option>
        ))}
      </select>
      <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none absolute right-3 text-mute">
        <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
    </label>
  )
}
