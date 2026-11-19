// scripts/lib/insights/engine/score.ts
// Newsworthiness (spec §2.4). All weights are initial values, tuned with
// npm run insights:replay. Pure.
import type { FrameType, SalienceClass, ScoreParts, Surface } from '../../../../src/lib/insights/types';
import { daysBetween } from './dates.js';
import type { Fact, FactKind, PriorState, RosterPlayer, Sample } from './types.js';

export const ALPHA = 10;
export const TRIVIAL_P = 0.25;
/** Milestones and records are always news. */
export const EXEMPT_FRAMES: readonly FrameType[] = ['career_high', 'records_best', 'only_one', 'milestone'];
export const EXEMPT_KINDS: FactKind[] = ['milestone', 'milestone_crossed', 'milestone_progress'];
export const HALF_LIFE_DAYS: Partial<Record<Surface, number>> = { postgame: 3, season: 14, player: 21 };
export const SALIENCE: Record<SalienceClass, number> = { roster_core: 1.0, roster: 0.8, team: 0.9, former: 0.5, opponent: 0.8 };
export const CORE_MPG = 20;
export const NEGATIVE_POLARITY = 0.8;
export const NOVELTY_NEW = 0.1;
export const NOVELTY_NEW_DAYS = 2;
export const NOVELTY_STALE_AFTER_DAYS = 14;
export const NOVELTY_DECAY_PER_DAY = 0.02;
export const NOVELTY_FLOOR = -0.2;
const P_FLOOR = 1e-6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function probability(sample: Sample): number | null {
  if (sample.kind === 'context') return null;
  if (sample.kind === 'share') return clamp(sample.p, P_FLOOR, 1);
  const shrunk = (sample.k + ALPHA * sample.pRef) / (sample.n + ALPHA);
  return clamp(shrunk ** sample.power, P_FLOOR, 1);
}

export function rarity(p: number | null): number {
  if (p === null) return 0;
  return clamp(-Math.log10(Math.max(p, 1e-12)) / 3, 0, 1);
}

export function isTrivial(p: number | null, frame: FrameType, kind: FactKind): boolean {
  return p !== null && p > TRIVIAL_P && !EXEMPT_FRAMES.includes(frame) && !EXEMPT_KINDS.includes(kind);
}

export function salienceClass(subject: Fact['subject'], roster: Map<string, RosterPlayer>): SalienceClass {
  if (subject.type === 'team') return 'team';
  const player = roster.get(subject.id);
  if (!player) return 'former';
  return player.mpg >= CORE_MPG ? 'roster_core' : 'roster';
}

export function recency(surface: Surface, ageDays: number): number {
  if (surface === 'pregame') return ageDays <= 0 ? 1 : 0;
  const halfLife = HALF_LIFE_DAYS[surface];
  if (!halfLife) return 1;
  return Math.exp((-Math.LN2 * Math.max(0, ageDays)) / halfLife);
}

export function novelty(asOf: string, firstEmittedAt: string | null, unchanged: string | null): number {
  if (firstEmittedAt === null) return NOVELTY_NEW;
  if (daysBetween(firstEmittedAt, asOf) <= NOVELTY_NEW_DAYS) return NOVELTY_NEW;
  const days = daysBetween(unchanged ?? firstEmittedAt, asOf);
  if (days <= NOVELTY_STALE_AFTER_DAYS) return 0;
  return Math.max(NOVELTY_FLOOR, -NOVELTY_DECAY_PER_DAY * (days - NOVELTY_STALE_AFTER_DAYS));
}

export function unchangedSince(prior: PriorState | null, headline: string, frameType: FrameType, asOf: string): string {
  if (prior && prior.headline === headline && prior.frameType === frameType) {
    return prior.unchangedSince ?? prior.firstEmittedAt;
  }
  return asOf;
}

export interface ScoreInput {
  surface: Surface;
  kind: FactKind;
  sample: Sample;
  frameStrength: number;
  salienceClass: SalienceClass;
  polarity: Fact['polarity'];
  ageDays: number;
  asOf: string;
  firstEmittedAt: string | null;
  unchangedSince: string;
}

export function scoreInsight(i: ScoreInput): ScoreParts {
  const p = probability(i.sample);
  const r = rarity(p);
  const base = 0.6 * r + 0.4 * i.frameStrength;
  const salience = SALIENCE[i.salienceClass];
  const rec = recency(i.surface, i.ageDays);
  const polarity = i.polarity === 'negative' ? NEGATIVE_POLARITY : 1;
  const nov = novelty(i.asOf, i.firstEmittedAt, i.unchangedSince);
  const rate = i.sample.kind === 'rate' ? i.sample : null;
  return {
    p,
    k: rate?.k ?? null,
    n: rate?.n ?? null,
    p_ref: rate?.pRef ?? null,
    power: rate?.power ?? null,
    rarity: r,
    frame_strength: i.frameStrength,
    base,
    salience,
    salience_class: i.salienceClass,
    age_days: i.ageDays,
    half_life_days: HALF_LIFE_DAYS[i.surface] ?? null,
    recency: rec,
    polarity,
    novelty: nov,
    unchanged_since: i.unchangedSince,
    importance: clamp(Math.round(100 * (base * salience * rec * polarity + nov)), 0, 100),
  };
}
