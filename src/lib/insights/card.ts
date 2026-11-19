// src/lib/insights/card.ts
// Pure card data for the insights UI: one stored row in, one display shape out.
// DB-free, relative imports only. Legacy and live rows (frame null, proof_result
// not an array) become plain cards and never throw.
import { factDate, proofParts, type BarRow, type ProofPart } from './quality';
import { fmtShort } from './time';
import type { TeamYoyRow } from './team-yoy';
import type { EntityRef, Evidence, Frame, Surface } from './types';

export interface CardSourceRow extends BarRow {
  headline: string;
  importance: number;
  entities: EntityRef[] | null;
  updated_at: string;
  nba_person_id: number | null;
  player_name: string | null;
  opp_abbr: string | null;
  lac_home: boolean | null;
  lac_score: number | null;
  opp_score: number | null;
  merged_ids?: string[];
}

export type CardSubject =
  | { kind: 'player'; name: string; nba_person_id: number | null }
  | { kind: 'team'; abbr: 'LAC'; name: 'Clippers' };

export interface InsightCardData {
  insight_id: string;
  surface: Surface | null;
  category: string;
  headline: string;
  detail: string | null;
  importance: number;
  player_id: string | null;
  game_id: string | null;
  season_id: number | null;
  subject: CardSubject;
  context_label: string;
  fact_date: string | null;
  href: string | null;
  frame: Frame | null;
  evidence: Evidence | null;
  proof: ProofPart[];
  updated_at: string;
  merged_ids: string[];
  team_yoy?: TeamYoyRow[];
}

export interface MatchupNote {
  insight_id: string;
  category: string;
  text: string;
  aside: string;
  icon: string | null;
  player: { name: string; nba_person_id: number | null } | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  yoy_change: 'vs last season',
  streak: 'Streak',
  league_rank: 'League rank',
  standings: 'Standings',
  milestone: 'Milestone',
  milestone_crossed: 'Milestone',
  milestone_progress: 'Milestone watch',
  season_best: 'Season high',
  recent_form: 'Recent form',
  opp_rank: 'Scouting',
};

function humanize(category: string): string {
  const s = category.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function gameLabel(row: CardSourceRow, date: string | null): string | null {
  if (!row.game_id || !date || !row.opp_abbr) return null;
  const when = fmtShort(date);
  const where = row.lac_home === false ? `at ${row.opp_abbr}` : `vs ${row.opp_abbr}`;
  if (row.surface === 'postgame' && row.lac_score !== null && row.opp_score !== null) {
    const wl = row.lac_score > row.opp_score ? 'W' : 'L';
    return `${when} · ${wl} ${row.lac_score}-${row.opp_score} ${where}`;
  }
  return `${when} · ${where}`;
}

function hrefFor(row: CardSourceRow): string | null {
  if (row.game_id && row.surface === 'postgame') return `/history/${row.game_id}`;
  if (row.game_id && row.surface === 'pregame') return `/schedule/${row.game_id}`;
  if (row.surface === 'player' && row.player_id) return `/players/${row.player_id}`;
  return null;
}

function subjectFor(row: CardSourceRow): CardSubject {
  if (row.player_id && row.player_name) {
    return { kind: 'player', name: row.player_name, nba_person_id: row.nba_person_id ?? null };
  }
  return { kind: 'team', abbr: 'LAC', name: 'Clippers' };
}

export function toCardData(row: CardSourceRow): InsightCardData {
  const date = factDate(row);
  return {
    insight_id: row.insight_id,
    surface: row.surface,
    category: row.category,
    headline: row.headline,
    detail: row.detail,
    importance: row.importance,
    player_id: row.player_id,
    game_id: row.game_id,
    season_id: row.season_id,
    subject: subjectFor(row),
    context_label: gameLabel(row, date) ?? CATEGORY_LABELS[row.category] ?? humanize(row.category),
    fact_date: date,
    href: hrefFor(row),
    frame: row.frame ?? null,
    evidence: row.evidence ?? null,
    proof: proofParts(row.proof_result),
    updated_at: row.updated_at,
    merged_ids: row.merged_ids ?? [],
  };
}

const NOTE_META: Record<string, { icon: string | null; aside: string }> = {
  opp_form: { icon: 'L10', aside: 'form' },
  last_meeting: { icon: 'H2H', aside: 'last meeting' },
  h2h: { icon: 'H2H', aside: 'head to head' },
  vs_opponent: { icon: null, aside: 'vs opponent' },
  opp_hot_player: { icon: null, aside: 'hot' },
  rest: { icon: 'RST', aside: 'rest' },
  line: { icon: 'ODDS', aside: 'line' },
};

export function toMatchupNote(row: CardSourceRow): MatchupNote {
  const meta = NOTE_META[row.category] ?? { icon: null, aside: humanize(row.category).toLowerCase() };
  const wantsPlayer = row.category === 'vs_opponent' || row.category === 'opp_hot_player';
  return {
    insight_id: row.insight_id,
    category: row.category,
    text: row.headline,
    aside: meta.aside,
    icon: meta.icon,
    player: wantsPlayer && row.player_name ? { name: row.player_name, nba_person_id: row.nba_person_id ?? null } : null,
  };
}
