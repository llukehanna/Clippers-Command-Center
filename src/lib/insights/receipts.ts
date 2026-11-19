// src/lib/insights/receipts.ts
// Pure Receipts table for a card's proof rows. Legacy rows (proof not an array)
// have no proof parts and return null. DB-free, relative imports only.
import type { InsightCardData } from './card';
import { fmtDate, seasonText } from './time';

export interface ReceiptTable {
  columns: { key: string; label: string; numeric: boolean }[];
  rows: { cells: string[]; me: boolean }[];
  source: string;
}

const STAT_LABEL: Record<string, string> = { pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', fg3m: '3PM' };
const MAX_ROWS = 8;

const COLS: { key: string; label: (stat: string | undefined) => string; numeric: boolean }[] = [
  { key: 'game_date', label: () => 'Date', numeric: false },
  { key: 'season_id', label: () => 'Season', numeric: false },
  { key: 'subject_name', label: () => 'Player', numeric: false },
  { key: 'value', label: (s) => (s && STAT_LABEL[s]) || 'Value', numeric: true },
  { key: 'games', label: () => 'GP', numeric: true },
  { key: 'streak', label: () => 'Length', numeric: true },
  { key: 'streak_start', label: () => 'From', numeric: false },
  { key: 'streak_end', label: () => 'To', numeric: false },
  { key: 'rank', label: () => 'Rank', numeric: true },
  { key: 'total_teams', label: () => 'Of', numeric: true },
  { key: 'wins', label: () => 'W', numeric: true },
  { key: 'losses', label: () => 'L', numeric: true },
  { key: 'games_since', label: () => 'Games between', numeric: true },
];

const present = (v: unknown) => (typeof v === 'string' && v !== '') || (typeof v === 'number' && Number.isFinite(v));

function cell(key: string, v: unknown): string {
  if (!present(v)) return '—';
  if (key === 'game_date' || key === 'streak_start' || key === 'streak_end') {
    return typeof v === 'string' ? fmtDate(v) : String(v);
  }
  if (key === 'season_id') return typeof v === 'number' ? seasonText(v) : String(v);
  return String(v);
}

const dash = (s: string) => s.replace('-', '–');

/** ISO instant to Pacific time, e.g. 'Nov 18, 11:40 PM PT'. */
export function formatVerified(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.month} ${p.day}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()} PT`;
}

export function receiptTable(card: InsightCardData): ReceiptTable | null {
  if (card.proof.length === 0) return null;
  const stat = typeof card.frame?.stat === 'string' ? card.frame.stat : undefined;
  // Cap the table but always keep the fact row (it is the "me" row), first.
  const safe = card.proof.map((p) => ({ part: p.part, data: (p.data && typeof p.data === 'object' ? p.data : {}) as Record<string, unknown> }));
  const fact = safe.find((p) => p.part === 'fact');
  const parts = (fact ? [fact, ...safe.filter((p) => p !== fact)] : safe).slice(0, MAX_ROWS);
  const used = COLS.filter((c) => parts.some((p) => present(p.data[c.key])));
  if (used.length === 0) return null;
  const verified = formatVerified(card.updated_at);
  const label = card.frame?.records_label;
  let source = `Proof query re-run nightly${verified ? ` · last verified ${verified}` : ''}`;
  if (label) source += ` · Records since ${dash(label)}`;
  return {
    columns: used.map((c) => ({ key: c.key, label: c.label(stat), numeric: c.numeric })),
    rows: parts.map((p) => {
      const me = p.part === 'fact';
      // The fact row is the card's own subject: name him when the Player column is shown and the row omits it.
      const value = (key: string) =>
        me && key === 'subject_name' && !present(p.data[key]) ? card.subject.name : p.data[key];
      return { cells: used.map((c) => cell(c.key, value(c.key))), me };
    }),
    source,
  };
}

export function sampleLabel(card: InsightCardData): string | null {
  // Precedence: the records label wins over the rank sample, which wins over yoy games.
  const label = card.frame?.records_label;
  if (label) return `Box scores since ${dash(label)}`;
  if (card.evidence?.type === 'rank_track') return `${card.evidence.total} ranked`;
  if (card.category === 'yoy_change') {
    const g = card.proof.find((p) => p.part === 'fact')?.data.games;
    if (typeof g === 'number' && Number.isFinite(g)) return `${g} games`;
  }
  return null;
}
