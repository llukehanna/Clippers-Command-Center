// scripts/lib/insights/engine/strength.ts
// Frame strengths (spec §2.3, plus the values the spec leaves open — see the
// plan's deviations) and the frames that need no query. Pure.
import type { Frame } from '../../../../src/lib/insights/types';
import type { Fact } from './types.js';

export const FIXED_STRENGTH = {
  career_high: 1.0, only_one: 0.95, records_best: 0.9, joins_company: 0.7, season_high: 0.6, nth_time: 0.4, none: 0.2,
} as const;

export function sinceStrength(years: number): number {
  if (years >= 10) return 0.9;
  if (years >= 5) return 0.8;
  if (years >= 2) return 0.65;
  return 0.5;
}

export function rankStrength(rank: number): number | null {
  if (rank === 1) return 0.85;
  if (rank <= 5) return 0.7;
  if (rank <= 10) return 0.55;
  return null;
}

/** Rank among Clippers since records start; rank 1 is records_best / only_one territory. */
export function clippersRankStrength(rank: number): number | null {
  if (rank <= 1 || rank > 10) return null;
  return rank <= 5 ? 0.7 : 0.55;
}

export function milestoneStrength(step: number): number {
  return Math.min(0.9, Math.round((0.7 + 0.05 * step) * 100) / 100);
}

export function noneFrame(): Frame {
  return { type: 'none', strength: FIXED_STRENGTH.none, who: 'group', text: '', proof_rows: [] };
}

const SPECIFICITY: Record<Frame['who'], number> = { subject: 2, group: 1, league: 0 };

export function pickFrame(frames: Frame[]): Frame {
  let best: Frame | null = null;
  for (const f of frames) {
    if (!best || f.strength > best.strength || (f.strength === best.strength && SPECIFICITY[f.who] > SPECIFICITY[best.who])) best = f;
  }
  return best ?? noneFrame();
}

/**
 * League-rank frame counted from whichever end the fact is notable at. A tie keeps the type and strength and carries
 * the tie count; the frame text (the template's context line) says "tied for" (FF-1).
 */
export function rankFrame(rank: number, total: number, bottom: boolean, tied = 0): Frame | null {
  const effective = bottom ? total - rank + 1 : rank;
  const strength = rankStrength(effective);
  if (strength === null) return null;
  return { type: 'league_rank', strength, who: 'league', text: '', rank, total, ...(tied > 0 ? { tied } : {}), proof_rows: [] };
}

export function computedFrames(fact: Fact): Frame[] {
  const d = fact.data;
  const ranked = () => {
    if (d.rank === undefined || d.total === undefined) return [];
    const f = rankFrame(d.rank, d.total, d.bottom === true, d.tied ?? 0);
    return f ? [f] : [];
  };
  switch (fact.kind) {
    case 'league_rank':
    case 'standings':
    case 'recent_form':
    case 'opp_rank':
      return ranked();
    case 'yoy_change':
      return d.yoy === 'team_rank' ? ranked() : [];
    case 'milestone':
    case 'milestone_crossed':
    case 'milestone_progress':
      return [{ type: 'milestone', strength: milestoneStrength(d.step ?? 0), who: 'subject', text: '', step: d.step ?? 0, proof_rows: [] }];
    default:
      return [];
  }
}
