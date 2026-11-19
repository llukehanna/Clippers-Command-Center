// src/lib/insights/quality.ts
// The insights quality bar (Q1-Q8): one verdict per stored insight row. Pure
// and DB-free; loaders supply the game-count context. Relative imports only.

import type { Evidence, Frame, Surface } from './types';

export const MIN_FIRST_SINCE_GAMES = 41;
export const MIN_SEASON_HIGH_TEAM_GAMES = 20;
export const MIN_STREAK_GAMES = 5;
export const MIN_SEASON_AVG_GAMES = 20;
export const CAREER_BEST_MARGIN = 0.05;
export const YOY_JUMP = 0.25;

/** Pregame matchup context: kept as notes when the row carries no frame. */
export const NOTE_CATEGORIES: readonly string[] = [
  'opp_form', 'last_meeting', 'vs_opponent', 'rest', 'line', 'h2h', 'opp_hot_player',
];

export type Verdict = 'card' | 'tag' | 'note' | 'merge' | 'cut';

export interface QualityContext {
  games_since: number | null;
  team_game_number: number | null;
}

export interface ProofPart {
  part: 'fact' | 'frame';
  data: Record<string, unknown>;
}

export interface BarRow {
  insight_id: string;
  surface: Surface | null;
  category: string;
  player_id: string | null;
  game_id: string | null;
  season_id: number | null;
  /** games.game_date of game_id (loaders join it in). */
  game_date: string | null;
  detail: string | null;
  frame: Frame | null;
  evidence: Evidence | null;
  proof_result: unknown;
}

export function proofParts(proof: unknown): ProofPart[] {
  if (!Array.isArray(proof)) return [];
  const out: ProofPart[] = [];
  for (const p of proof) {
    if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>;
      if ((o.part === 'fact' || o.part === 'frame') && o.data && typeof o.data === 'object') {
        out.push({ part: o.part, data: o.data as Record<string, unknown> });
      }
    }
  }
  return out;
}

export function factRow(proof: unknown): Record<string, unknown> | null {
  return proofParts(proof).find((p) => p.part === 'fact')?.data ?? null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function factDate(row: BarRow): string | null {
  if (row.game_date) return row.game_date;
  const f = factRow(row.proof_result);
  if (!f) return null;
  return str(f.game_date) ?? (row.category === 'streak' ? str(f.streak_end) : null);
}

export function untilDate(row: BarRow): string | null {
  if (row.category === 'streak') {
    const s = str(factRow(row.proof_result)?.streak_start);
    if (s) return s;
  }
  return factDate(row);
}

export function careerBestHolds(games: number, value: number, prior: number): boolean {
  if (games >= MIN_SEASON_AVG_GAMES) return true;
  if (prior <= 0) return value > prior;
  return (value - prior) / prior >= CAREER_BEST_MARGIN;
}

export function yoyJump(e: Evidence | null): number | null {
  if (!e || e.type !== 'delta' || e.before.value === 0) return null;
  // Magnitude only: a 30% drop is as newsworthy as a 30% rise.
  return Math.abs(e.after.value - e.before.value) / Math.abs(e.before.value);
}

const isPlayerYoy = (r: BarRow) => r.category === 'yoy_change' && r.player_id !== null;

/** Q7 rewrite (Ruling 10): withhold a fragile career best; add "Through N games" to a surviving jump. */
export function normalizeRow<T extends BarRow>(row: T): T {
  if (!isPlayerYoy(row) || !row.frame) return row;
  const games = num(factRow(row.proof_result)?.games);
  let frame = row.frame;
  if (frame.type === 'career_high' && games !== null && row.evidence?.type === 'delta'
      && typeof frame.prior_value === 'number'
      && !careerBestHolds(games, row.evidence.after.value, frame.prior_value)) {
    frame = { ...frame, type: 'none', strength: 0, text: '' };
  }
  if (frame.type !== 'none') return frame === row.frame ? row : { ...row, frame };
  const jump = yoyJump(row.evidence);
  const detail = games !== null && jump !== null && jump >= YOY_JUMP ? `Through ${games} games` : row.detail;
  return { ...row, frame, detail };
}

type Decision = Verdict | 'needs_context';

function decide(row: BarRow, ctx?: QualityContext): Decision {
  if (row.surface === null || row.surface === 'live') return 'card';
  const f = row.frame;
  const none = !f || f.type === 'none';
  if (none && row.surface === 'pregame' && NOTE_CATEGORIES.includes(row.category)) return 'note';
  if (none && row.category === 'yoy_change' && row.player_id === null) return 'merge';
  if (none) {
    const j = yoyJump(row.evidence);
    return isPlayerYoy(row) && j !== null && j >= YOY_JUMP ? 'card' : 'cut';
  }
  if (row.category === 'streak') {
    const s = num(factRow(row.proof_result)?.streak);
    if (s === null || s < MIN_STREAK_GAMES) return 'cut';
  }
  if ((f.type === 'first_since' || f.type === 'longest_since') && f.since_date) {
    const gs = f.games_since ?? ctx?.games_since ?? null;
    if (f.games_since === undefined && ctx === undefined) return 'needs_context';
    return gs === null || gs < MIN_FIRST_SINCE_GAMES ? 'cut' : 'card';
  }
  if (f.type === 'season_high' && f.who === 'group') {
    if (ctx === undefined) return 'needs_context';
    const n = ctx.team_game_number;
    return n === null || n < MIN_SEASON_HIGH_TEAM_GAMES ? 'cut' : 'card';
  }
  if (f.type === 'season_high' && f.who === 'subject') return 'tag';
  return 'card';
}

export function verdict(row: BarRow, ctx?: QualityContext): Verdict {
  const d = decide(normalizeRow(row), ctx);
  return d === 'needs_context' ? 'cut' : d;
}

export interface ContextNeed {
  insight_id: string;
  player_id: string | null;
  since_date: string | null;
  until_date: string | null;
  at_date: string | null;
  season_id: number | null;
}

export function contextNeeds(rows: BarRow[]): ContextNeed[] {
  const out: ContextNeed[] = [];
  for (const raw of rows) {
    const row = normalizeRow(raw);
    if (decide(row) !== 'needs_context') continue;
    const f = row.frame;
    if (!f) continue;
    if (f.type === 'season_high') {
      out.push({
        insight_id: row.insight_id, player_id: null, since_date: null, until_date: null,
        at_date: factDate(row), season_id: row.season_id,
      });
    } else {
      out.push({
        insight_id: row.insight_id,
        player_id: f.who === 'subject' ? row.player_id : null,
        since_date: f.since_date ?? null, until_date: untilDate(row), at_date: null,
        season_id: row.season_id,
      });
    }
  }
  return out;
}

export interface BarResult<T> {
  cards: T[];
  tags: T[];
  notes: T[];
  merged: T[];
}

export function applyBar<T extends BarRow>(
  rows: T[],
  context: ReadonlyMap<string, QualityContext>,
): BarResult<T> {
  const out: BarResult<T> = { cards: [], tags: [], notes: [], merged: [] };
  for (const raw of rows) {
    const row = normalizeRow(raw);
    const v = verdict(row, context.get(row.insight_id));
    if (v === 'card') out.cards.push(row);
    else if (v === 'tag') out.tags.push(row);
    else if (v === 'note') out.notes.push(row);
    else if (v === 'merge') out.merged.push(row);
  }
  return out;
}
