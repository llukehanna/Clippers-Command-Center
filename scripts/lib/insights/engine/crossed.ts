// scripts/lib/insights/engine/crossed.ts
// Pure parts of the postgame milestone detector (DB-free so unit tests can import them).

export interface CareerMilestoneDef {
  key: 'career_points' | 'career_rebounds' | 'career_assists' | 'career_threes';
  column: 'points' | 'rebounds' | 'assists' | 'fg3_made';
  thresholds: readonly number[];
  unit: string;
}

export const CAREER_MILESTONES: CareerMilestoneDef[] = [
  { key: 'career_points', column: 'points', thresholds: [5000, 10000, 15000, 20000, 25000, 30000], unit: 'points' },
  { key: 'career_rebounds', column: 'rebounds', thresholds: [2500, 5000, 7500, 10000], unit: 'rebounds' },
  { key: 'career_assists', column: 'assists', thresholds: [2500, 5000, 7500, 10000], unit: 'assists' },
  { key: 'career_threes', column: 'fg3_made', thresholds: [500, 1000, 1500, 2000, 2500], unit: 'threes' },
];

export function crossedThreshold(before: number, through: number, thresholds: readonly number[]): number | null {
  let best: number | null = null;
  for (const t of thresholds) if (before < t && through >= t && (best === null || t > best)) best = t;
  return best;
}
