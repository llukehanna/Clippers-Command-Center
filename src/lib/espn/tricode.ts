// src/lib/espn/tricode.ts
// ESPN team abbreviations that differ from NBA tricodes.
export const ESPN_TO_NBA: Record<string, string> = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' };

export function espnTricode(abbr?: string | null): string {
  return abbr ? ESPN_TO_NBA[abbr] ?? abbr : '';
}
