'use client'

import { useState, useMemo } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface BoxScoreColumn {
  key: string
  label: string
  numeric?: boolean   // if true: right-aligned, tabular-nums
  width?: string      // Tailwind width class e.g. "w-16"
}

export interface BoxScoreRow {
  id: string
  [key: string]: string | number | null | undefined
}

interface BoxScoreTableProps {
  columns: BoxScoreColumn[]
  rows: BoxScoreRow[]
  maxHeight?: string   // Tailwind max-h class e.g. "max-h-[480px]"
  className?: string
}

type SortDir = 'asc' | 'desc'

function isTotalsRow(row: BoxScoreRow): boolean {
  return String(row.id).startsWith('totals-')
}

/** Numeric sort value; parses "mm:ss" minutes (e.g. "34:12") to decimal minutes. */
function toSortNumber(value: string | number): number {
  if (typeof value === 'number') return value
  const clock = /^(\d+):(\d{1,2})$/.exec(value.trim())
  if (clock) return parseInt(clock[1], 10) + parseInt(clock[2], 10) / 60
  return Number(value)
}

export function BoxScoreTable({
  columns,
  rows,
  maxHeight = 'max-h-[480px]',
  className,
}: BoxScoreTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortedRows = useMemo(() => {
    // Totals rows (id "totals-<ABBR>") stay pinned to the bottom regardless of sort
    const body = rows.filter((r) => !isTotalsRow(r))
    const totals = rows.filter(isTotalsRow)
    if (!sortKey) return [...body, ...totals]
    const sorted = [...body].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      // Nulls last
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const numA = toSortNumber(av)
      const numB = toSortNumber(bv)
      const isNumeric = !isNaN(numA) && !isNaN(numB)
      if (isNumeric) {
        return sortDir === 'asc' ? numA - numB : numB - numA
      }
      const sa = String(av)
      const sb = String(bv)
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa)
    })
    return [...sorted, ...totals]
  }, [rows, sortKey, sortDir])

  return (
    // Custom scroll container — NOT the shadcn Table's wrapper div
    <div
      className={cn(
        'overflow-y-auto rounded-md',
        maxHeight,
        className
      )}
    >
      <table className="w-full caption-bottom text-sm">
        {/* sticky top-0 works here because the parent div is the scroll container */}
        <thead className="sticky top-0 z-10 border-b border-border-strong bg-surface-alt">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={
                  sortKey === col.key
                    ? sortDir === 'asc' ? 'ascending' : 'descending'
                    : 'none'
                }
                className={cn(
                  'ccc-table-meta px-3 py-2.5 whitespace-nowrap',
                  col.numeric ? 'text-right' : 'text-left',
                  col.width
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSort(col.key)}
                  className="cursor-pointer select-none uppercase hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:underline transition-colors duration-150"
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1 opacity-60" aria-hidden>
                      {sortDir === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr
              key={row.id}
              className="h-9 border-b border-border-subtle transition-colors duration-150 last:border-0 hover:bg-white/[0.06]"
            >
              {columns.map((col, colIndex) => {
                const val = row[col.key]
                return (
                  <td
                    key={col.key}
                    className={cn(
                      'ccc-body px-3 py-2',
                      col.numeric ? 'text-right tabular-nums' : 'text-left',
                      !col.numeric && colIndex === 0 ? 'font-medium' : ''
                    )}
                  >
                    {val ?? '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Re-export shadcn Table primitives for potential use by consumers
export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow }
