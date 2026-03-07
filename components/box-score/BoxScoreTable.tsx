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
    if (!sortKey) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      // Nulls last
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const numA = Number(av)
      const numB = Number(bv)
      const isNumeric = !isNaN(numA) && !isNaN(numB)
      if (isNumeric) {
        return sortDir === 'asc' ? numA - numB : numB - numA
      }
      const sa = String(av)
      const sb = String(bv)
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa)
    })
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
        <thead className="sticky top-0 z-10 bg-surface border-b border-white/[0.04]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={cn(
                  'px-3 py-2 text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors duration-150',
                  col.numeric ? 'text-right' : 'text-left',
                  col.width
                )}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-1 opacity-60">
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors duration-150 h-9"
            >
              {columns.map((col, colIndex) => {
                const val = row[col.key]
                return (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-2 text-[0.8125rem] text-foreground',
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
