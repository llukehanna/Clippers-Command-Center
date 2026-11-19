// src/lib/insights/team-yoy.ts
// Q8: the Clippers' offense, defense and net rating ranks merge into one card.
// Pure, DB-free. Reads the stored proof rows (one fact row per season).
import { toCardData, type CardSourceRow, type InsightCardData } from './card';
import { proofParts } from './quality';
import type { WhyChip } from './why';

export interface TeamYoyRow {
  label: 'Offense' | 'Defense' | 'Net' | 'Record';
  from: number;
  to: number;
  total: number;
}

const ORDER: TeamYoyRow['label'][] = ['Offense', 'Defense', 'Net'];

function labelFor(row: CardSourceRow, fact: Record<string, unknown> | undefined): TeamYoyRow['label'] | null {
  const key = (typeof row.frame?.stat === 'string' && row.frame.stat)
    || (fact && typeof fact.stat === 'string' ? fact.stat : '')
    || '';
  if (key === 'record') return 'Record';
  if (/_off_/.test(key)) return 'Offense';
  if (/_def_/.test(key)) return 'Defense';
  if (/_net_/.test(key)) return 'Net';
  if (key) return null;
  // Rows written before frame.stat existed: fall back to the headline wording.
  const h = row.headline.toLowerCase();
  if (/offens/.test(h)) return 'Offense';
  if (/defens/.test(h)) return 'Defense';
  if (/\bnet\b/.test(h)) return 'Net';
  return null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One rating row for the merged card; null for the record and for rows whose proof lacks two seasons. */
export function teamYoyRow(row: CardSourceRow): TeamYoyRow | null {
  const facts = proofParts(row.proof_result)
    .filter((p) => p.part === 'fact')
    .map((p) => p.data)
    .filter((d) => finite(d.season_id) && finite(d.rank));
  const label = labelFor(row, facts[0]);
  if (!label || label === 'Record') return null;
  if (facts.length < 2) return null;
  const sorted = [...facts].sort((a, b) => (a.season_id as number) - (b.season_id as number));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first.season_id === last.season_id) return null;
  const total = finite(last.total_teams) ? last.total_teams : finite(first.total_teams) ? first.total_teams : null;
  if (total === null) return null;
  return { label, from: first.rank as number, to: last.rank as number, total };
}

/**
 * The merged card's chip. Rows are league ranks, where a lower number is
 * better for every rating (the defensive rank is already ordered best-first),
 * so a rank that grew is a rating that worsened.
 */
export function teamYoyChip(rows: TeamYoyRow[]): WhyChip | null {
  const valid = rows.filter((r) => finite(r.from) && finite(r.to));
  const n = valid.length;
  if (n === 0) return null;
  const worse = valid.filter((r) => r.to > r.from).length;
  const better = valid.filter((r) => r.to < r.from).length;
  if (n === 1) {
    if (worse) return { label: `${valid[0].label} down`, tone: 'low' };
    if (better) return { label: `${valid[0].label} up`, tone: 'career' };
    return null;
  }
  if (worse === n) return { label: `Down in all ${n}`, tone: 'low' };
  if (better === n) return { label: `Up in all ${n}`, tone: 'career' };
  if (worse > 0) return { label: `Down in ${worse} of ${n}`, tone: 'low' };
  return null;
}

const PHRASE: Record<string, string> = { Offense: 'offense', Defense: 'defense', Net: 'net rating' };

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function mergeTeamYoy(rows: CardSourceRow[]): InsightCardData | null {
  // One entry per label: keep the highest-importance row, then the most recently updated.
  const byLabel = new Map<string, { row: CardSourceRow; yoy: TeamYoyRow }>();
  const dupes: string[] = [];
  for (const row of rows) {
    const yoy = teamYoyRow(row);
    if (!yoy) continue;
    const cur = byLabel.get(yoy.label);
    if (!cur) { byLabel.set(yoy.label, { row, yoy }); continue; }
    const wins = row.importance > cur.row.importance
      || (row.importance === cur.row.importance && row.updated_at > cur.row.updated_at);
    if (wins) { dupes.push(cur.row.insight_id); byLabel.set(yoy.label, { row, yoy }); } else dupes.push(row.insight_id);
  }
  const parsed = [...byLabel.values()];
  if (parsed.length === 0) return null;
  parsed.sort((a, b) => ORDER.indexOf(a.yoy.label) - ORDER.indexOf(b.yoy.label));

  const base = parsed.reduce((best, p) => (p.row.importance > best.row.importance ? p : best), parsed[0]).row;
  const yoy = parsed.map((p) => p.yoy);
  // A lower rank number is better.
  const improved = yoy.every((y) => y.to < y.from);
  const slipped = yoy.every((y) => y.to > y.from);
  const names = list(yoy.map((y) => PHRASE[y.label]));
  const headline = slipped
    ? `The Clippers have slipped in ${names}`
    : improved
      ? `The Clippers have improved in ${names}`
      : "The Clippers' league ranks vs last season";

  const card = toCardData(base);
  return {
    ...card,
    headline,
    detail: null,
    subject: { kind: 'team', abbr: 'LAC', name: 'Clippers' },
    context_label: 'League ranks vs last season',
    href: null,
    frame: null,
    evidence: null,
    proof: [],
    importance: Math.max(...parsed.map((p) => p.row.importance)),
    updated_at: parsed.map((p) => p.row.updated_at).sort().at(-1) ?? base.updated_at,
    merged_ids: [...parsed.filter((p) => p.row !== base).map((p) => p.row.insight_id), ...dupes],
    team_yoy: yoy,
  };
}
