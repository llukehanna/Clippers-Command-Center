/** Parses "made-attempted" FT string (e.g., "18-24") and returns made count. */
function parseFtMade(ft: string): number {
  const made = parseInt(ft.split('-')[0], 10)
  return isNaN(made) ? 0 : made
}

/**
 * Computes FT made delta: LAC FTM minus opponent FTM.
 * Both params are "made-attempted" strings from box_score.teams[].totals.FT.
 */
export function computeFtEdge(lacFt: string, oppFt: string): number {
  return parseFtMade(lacFt) - parseFtMade(oppFt)
}

/**
 * Returns the next circular index for insight rotation.
 * Extracted as a pure function so rotation logic is testable without jsdom.
 * Imported by hooks/useInsightRotation.ts.
 */
export function getNextIndex(current: number, length: number): number {
  if (length <= 1) return 0
  return (current + 1) % length
}
