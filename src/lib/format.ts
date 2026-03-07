export function formatClock(isoStr: string): string {
  const match = isoStr.match(/PT(?:(\d+)M)?(?:([\d.]+)S)?/)
  if (!match) return isoStr
  const mins = parseInt(match[1] ?? '0', 10)
  const secs = Math.floor(parseFloat(match[2] ?? '0'))
  return `${mins}:${String(secs).padStart(2, '0')}`
}
