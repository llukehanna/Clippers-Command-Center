'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Table primitives. The scroll wrapper keeps wide tables inside their panel on
 * phones; `stickyFirst` pins the first column while the rest scrolls.
 */
export function TableScroll({ children, className, minWidth = 560 }: { children: React.ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-[13.5px] tabular-nums" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

type Align = 'left' | 'right' | 'center'

const alignClass = (a: Align) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left')

export function Th({
  children,
  align = 'right',
  sticky,
  className,
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: Align; sticky?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-2.5 pb-2 pt-3 font-mono text-[10.5px] font-normal uppercase tracking-[0.12em] text-dim first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5',
        alignClass(align),
        sticky && 'max-md:sticky max-md:left-0 max-md:z-[1] max-md:bg-ink-1',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  align = 'right',
  sticky,
  strong,
  muted,
  className,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: Align; sticky?: boolean; strong?: boolean; muted?: boolean }) {
  return (
    <td
      className={cn(
        'whitespace-nowrap border-t border-line px-2.5 py-2.5 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5',
        alignClass(align),
        sticky && 'max-md:sticky max-md:left-0 max-md:z-[1] max-md:bg-ink-1',
        strong && 'font-semibold text-text',
        muted && 'text-mute',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  )
}

/**
 * Row that navigates on click. Row links don't prefetch: tables list dozens
 * of dynamic pages, and prefetching each would render them all server-side. The row's primary cell should also contain a
 * real <RowLink> so keyboard and screen-reader users get a link.
 */
export function Tr({ href, className, children }: { href?: string; className?: string; children: React.ReactNode }) {
  const router = useRouter()
  return (
    <tr
      className={cn('group', href && 'cursor-pointer', '[&>td]:transition-colors [&>td]:duration-200 hover:[&>td]:bg-[#0f1829]', className)}
      onClick={href ? () => router.push(href) : undefined}
    >
      {children}
    </tr>
  )
}

export function RowLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} prefetch={false} onClick={(e) => e.stopPropagation()} className={cn('outline-none hover:text-text focus-visible:underline', className)}>
      {children}
    </Link>
  )
}
