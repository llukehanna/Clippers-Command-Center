'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import type { ReceiptTable } from '@/src/lib/insights/receipts'

/**
 * The Receipts toggle and its proof table (insights.css:54-67). Rendered inside
 * the card footer, which sits above the card's stretched link, so the button
 * is never nested in the link. The table region wraps onto its own line.
 */
export function Receipts({ table }: { table: ReceiptTable }) {
  const [open, setOpen] = React.useState(false)
  const id = React.useId()
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="group ml-auto inline-flex items-center gap-[5px] rounded-full px-[9px] py-[3px] font-mono text-[10.5px] text-mute shadow-[inset_0_0_0_1px_var(--line-2)] transition-colors duration-200 hover:bg-white/5 hover:text-text aria-expanded:bg-[rgba(65,143,222,0.16)] aria-expanded:text-white aria-expanded:shadow-[inset_0_0_0_1px_rgba(65,143,222,0.4)]"
      >
        Receipts
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden
          className="transition-transform duration-300 ease-premium group-aria-expanded:rotate-180"
        >
          <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      <div
        id={id}
        hidden={!open}
        className="rc-body relative z-[3] -mx-1 mb-0.5 mt-1.5 grow basis-full rounded-[12px] bg-black/[0.28] px-3 py-2.5 font-sans shadow-[inset_0_0_0_1px_var(--line)]"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn(
                      'pb-1.5 pr-2 text-left font-mono text-[10px] font-normal uppercase tracking-[0.1em] text-dim',
                      c.numeric && 'text-right',
                    )}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.cells.map((cell, j) => (
                    <td
                      key={table.columns[j].key}
                      className={cn(
                        'whitespace-nowrap border-t border-line py-[5px] pr-2 text-mute',
                        r.me && 'text-text',
                        table.columns[j].numeric && 'text-right font-medium text-text',
                        r.me && j === 0 && 'pl-2 shadow-[inset_2px_0_0_var(--pacific)]',
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 font-mono text-[10px] text-dim">{table.source}</div>
      </div>
    </>
  )
}
