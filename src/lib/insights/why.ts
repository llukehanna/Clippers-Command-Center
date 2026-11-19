// src/lib/insights/why.ts
// The "why it matters" chip on an insight card. Pure and DB-free. A chip never
// claims more than its frame proves, and time phrasing comes from since_date /
// years only, never from frame.games_since (that count can undercount).
import { ordinal } from '../record-notes';
import { yearsBetween } from './time';
import type { Evidence, Frame, Surface } from './types';

export type WhyTone = 'rare' | 'career' | 'gold' | 'low' | 'ctx';
export interface WhyChip { label: string; tone: WhyTone }
export interface WhyInput {
  category: string;
  surface: Surface | null;
  player_id: string | null;
  frame: Frame | null;
  evidence: Evidence | null;
  fact_date: string | null;
}

/** Years from since_date to the fact date; falls back to frame.years when either date is missing. */
function yearsFor(frame: Frame, factDate: string | null): number | null {
  if (frame.since_date && factDate) {
    const y = yearsBetween(frame.since_date, factDate);
    if (Number.isFinite(y) && y >= 0) return y;
  }
  return typeof frame.years === 'number' && Number.isFinite(frame.years) ? frame.years : null;
}

function firstInLabel(y: number): string {
  if (y >= 1) {
    const half = Math.round(y * 2) / 2;
    const whole = Math.floor(half);
    const n = half % 1 ? `${whole}½` : `${whole}`;
    return `First in ${n} ${half === 1 ? 'yr' : 'yrs'}`;
  }
  const mo = Math.max(1, Math.round(y * 12));
  return mo >= 12 ? 'First in 1 yr' : `First in ${mo} mo`;
}

/** "'21" from a YYYY-.. string. */
const shortYear = (s: string | undefined): string | null => {
  const m = s ? /^(\d{4})/.exec(s) : null;
  return m ? `'${m[1].slice(2)}` : null;
};

interface RankIn { rank: number; total: number | null; tied: number; where: string }

function rankLabel(r: RankIn, bottomOf: boolean): string {
  if (r.tied > 0) return `Tied for ${ordinal(r.rank)}`;
  if (bottomOf && r.total && r.rank > r.total - 5) return `${ordinal(r.rank)} of ${r.total}`;
  return `${ordinal(r.rank)} in ${r.where}`;
}

function frameRank(frame: Frame): RankIn | null {
  if (typeof frame.rank !== 'number') return null;
  return { rank: frame.rank, total: frame.total ?? null, tied: frame.tied ?? 0, where: 'NBA' };
}

const seasonsLabel = (n: number): string => `Best in ${n} season${n === 1 ? '' : 's'}`;

function yoyUp(e: Evidence | null): string | null {
  if (!e || e.type !== 'delta' || !e.betterIsHigher) return null;
  const b = e.before.value;
  const a = e.after.value;
  if (!(b > 0) || !(a > b)) return null;
  return `Up ${Math.round(((a - b) / b) * 100)}%`;
}

export function whyChip(input: WhyInput): WhyChip | null {
  const { frame, category, evidence } = input;
  if (!frame) return null;

  if (frame.type === 'none') {
    if (category === 'yoy_change' && input.player_id) {
      const label = yoyUp(evidence);
      return label ? { label, tone: 'career' } : null;
    }
    return null;
  }
  if (frame.type === 'nth_time') return null; // always cut by the bar

  if (category === 'standings') {
    const ev = evidence && evidence.type === 'rank_track' ? evidence : null;
    const r: RankIn | null = ev
      ? { rank: ev.rank, total: ev.total, tied: ev.tied ?? 0, where: ev.label.replace(/^the\s+/i, '') }
      : frameRank(frame);
    if (!r) return null;
    const low = r.tied === 0 && r.total !== null && r.rank > r.total / 2;
    return { label: rankLabel(r, false), tone: low ? 'low' : 'ctx' };
  }

  if (category === 'opp_rank') {
    const r = frameRank(frame);
    if (!r) return null;
    return { label: rankLabel(r, true), tone: r.rank <= 5 ? 'low' : 'ctx' };
  }

  switch (frame.type) {
    case 'first_since': {
      if (!frame.since_date && frame.since_label) {
        return typeof frame.years === 'number' && frame.years >= 1
          ? { label: seasonsLabel(Math.round(frame.years)), tone: 'rare' }
          : null;
      }
      const y = yearsFor(frame, input.fact_date);
      return y === null ? null : { label: firstInLabel(y), tone: 'rare' };
    }
    case 'longest_since': {
      const yr = shortYear(frame.since_date) ?? shortYear(frame.since_label);
      return yr ? { label: `Longest since ${yr}`, tone: 'rare' } : null;
    }
    case 'career_high':
      return { label: 'Career high', tone: 'career' };
    case 'joins_company': {
      const n = frame.names ? frame.names.length + 1 : frame.count;
      return n && n >= 2 ? { label: `${ordinal(n)} Clipper`, tone: 'rare' } : null;
    }
    case 'league_rank': {
      const r = frameRank(frame);
      if (!r) return null;
      const tone = r.tied > 0 ? 'ctx' : r.total && r.rank > r.total - 5 ? 'low' : r.rank <= 5 ? 'rare' : 'ctx';
      return { label: rankLabel(r, true), tone };
    }
    case 'milestone':
      return { label: 'Milestone', tone: 'gold' };
    case 'records_best':
      return frame.records_seasons ? { label: seasonsLabel(frame.records_seasons), tone: 'rare' } : null;
    case 'only_one':
      return { label: 'Only Clipper', tone: 'rare' };
    case 'season_high':
      return frame.who === 'group'
        ? { label: 'Most this season', tone: 'rare' }
        : { label: 'Season high', tone: 'career' };
    default:
      return null;
  }
}

/** The blue tag beside a box-score stat. */
export function boxTagLabel(input: WhyInput): string | null {
  const f = input.frame;
  if (!f) return null;
  if (f.type === 'career_high') return 'Career high';
  if (f.type === 'first_since' && f.since_date) {
    const yr = shortYear(f.since_date);
    return yr ? `1st since ${yr}` : null;
  }
  return null;
}
