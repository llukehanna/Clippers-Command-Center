// src/lib/insights/kit-geometry.ts
// Pure geometry for the insight card kit's visuals (components/insights/kit).
// Ports the drawing math from the approved mockup (insights.js) so the React
// components stay markup-only. Every function returns null when its inputs
// can't draw a truthful visual; the card then renders without one.
// DB-free, relative imports only.
import { ordinal } from '../record-notes';
import type { TeamYoyRow } from './team-yoy';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 12 → '12', 1234 → '1,234', 14.83 → '14.8'. */
export function fmtNum(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(1);
}

// ── rank track (insights.js:99-124) ─────────────────────────────────────────

export type RankTickKind = 'base' | 'top5' | 'bot5' | 'tie' | 'me' | 'meBad';

/** One tick per rank up to this many; larger fields are bucketed into RANK_BUCKETS ticks. */
export const MAX_RANK_TICKS = 40;
export const RANK_BUCKETS = 30;

export function rankTicks(rank: number, total: number, tied = 0): RankTickKind[] | null {
  if (!finite(rank) || !finite(total) || !Number.isInteger(rank) || !Number.isInteger(total)) return null;
  if (total < 2 || rank < 1 || rank > total) return null;
  const t = finite(tied) && tied > 0 ? Math.floor(tied) : 0;
  const bad = total >= 10 && rank > total - 5;
  const n = total <= MAX_RANK_TICKS ? total : RANK_BUCKETS;
  // The tick (0-based) a 1-based rank falls in.
  const at = (r: number) => (n === total ? r - 1 : Math.min(n - 1, Math.floor(((r - 1) * n) / total)));
  const out: RankTickKind[] = Array.from({ length: n }, () => 'base');
  for (let r = 1; r <= Math.min(5, total); r++) out[at(r)] = 'top5';
  for (let r = Math.max(1, total - 4); r <= total; r++) out[at(r)] = 'bot5';
  for (let r = rank + 1; r <= Math.min(total, rank + t); r++) out[at(r)] = 'tie';
  out[at(rank)] = bad ? 'meBad' : 'me';
  return out;
}

// ── streak strip (insights.js:125-140) ──────────────────────────────────────

export interface StreakBar { value: number; hit: boolean; pct: number }

export function streakBars(games: { value: number; hit: boolean }[], threshold: number): StreakBar[] | null {
  if (!Array.isArray(games) || games.length === 0 || !finite(threshold)) return null;
  if (games.some((g) => !g || !finite(g.value))) return null;
  const max = Math.max(...games.map((g) => g.value), threshold) * 1.1;
  return games.map((g) => ({
    value: g.value,
    hit: g.hit === true,
    pct: max > 0 ? Math.max(0, (g.value / max) * 70) : 0,
  }));
}

// ── margin spark (insights.js:147-166) ──────────────────────────────────────

export const SPARK_W = 300;
export const SPARK_H = 56;

export interface SparkGeometry {
  line: string;
  area: string;
  mid: number;
  highlight: { x: number; width: number } | null;
}

export function sparkGeometry(series: [number, number][], highlight?: { from: number; to: number }): SparkGeometry | null {
  if (!Array.isArray(series) || series.length < 2) return null;
  if (series.some((p) => !Array.isArray(p) || !finite(p[0]) || !finite(p[1]))) return null;
  const W = SPARK_W;
  const H = SPARK_H;
  const tMax = series[series.length - 1][0];
  if (!(tMax > 0)) return null;
  const mAbs = Math.max(...series.map((p) => Math.abs(p[1]))) || 1;
  const x = (t: number) => (t / tMax) * W;
  const y = (m: number) => H / 2 - (m / mAbs) * (H / 2 - 3);
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const area = `${line}L${W},${H / 2}L0,${H / 2}Z`;
  let hl: SparkGeometry['highlight'] = null;
  if (highlight && finite(highlight.from) && finite(highlight.to) && highlight.to > highlight.from) {
    const x0 = Math.max(0, x(highlight.from));
    const x1 = Math.min(W, x(highlight.to));
    if (x1 > x0) hl = { x: Number(x0.toFixed(1)), width: Number((x1 - x0).toFixed(1)) };
  }
  return { line, area, mid: H / 2, highlight: hl };
}

// ── milestone bar (insights.css:168-169) ────────────────────────────────────

export function milestoneBar(current: number, target: number): { pct: number; remaining: number } | null {
  if (!finite(current) || !finite(target) || target <= 0 || current < 0) return null;
  return { pct: Math.min(100, (current / target) * 100), remaining: Math.max(0, target - current) };
}

// ── best bars (insights.js:90-98) ───────────────────────────────────────────

export function bestBars(prev: number, value: number): { prevPct: number; valuePct: number } | null {
  if (!finite(prev) || !finite(value) || prev < 0 || value < 0) return null;
  const max = Math.max(prev, value);
  if (!(max > 0)) return null;
  return { prevPct: (prev / max) * 100, valuePct: (value / max) * 100 };
}

// ── delta (insights.css:126-134) ────────────────────────────────────────────

export interface DeltaView { before: string; after: string; change: string | null; better: boolean }

export function deltaView(before: number, after: number, betterIsHigher: boolean): DeltaView | null {
  if (!finite(before) || !finite(after)) return null;
  const diff = Math.round((after - before) * 10) / 10;
  const better = betterIsHigher ? diff > 0 : diff < 0;
  const change = diff === 0 ? null : `${diff > 0 ? '+' : '−'}${fmtNum(Math.abs(diff))}`;
  return { before: fmtNum(before), after: fmtNum(after), change, better };
}

// ── team ratings mini deltas (insights.css:135-147) ─────────────────────────

export interface MiniDeltaRow {
  label: string;
  /** Positions along the 1st..total track, in percent. */
  from: number;
  to: number;
  lineLeft: number;
  lineWidth: number;
  /** A higher rank number is worse. */
  worse: boolean;
  fromText: string;
  toText: string;
}

const rankPct = (rank: number, total: number) => ((rank - 1) / (total - 1)) * 100;

export function miniDeltas(rows: TeamYoyRow[]): { rows: MiniDeltaRow[]; axisEnd: string } | null {
  if (!Array.isArray(rows)) return null;
  const out: MiniDeltaRow[] = [];
  for (const r of rows) {
    if (!finite(r.from) || !finite(r.to) || !finite(r.total) || r.total < 2) continue;
    if (r.from < 1 || r.to < 1 || r.from > r.total || r.to > r.total) continue;
    const a = rankPct(r.from, r.total);
    const b = rankPct(r.to, r.total);
    out.push({
      label: r.label,
      from: Number(a.toFixed(1)),
      to: Number(b.toFixed(1)),
      lineLeft: Number(Math.min(a, b).toFixed(1)),
      lineWidth: Number(Math.abs(b - a).toFixed(1)),
      worse: r.to > r.from,
      fromText: ordinal(r.from),
      toText: ordinal(r.to),
    });
  }
  if (out.length === 0) return null;
  const total = rows.find((r) => finite(r.total) && r.total >= 2)?.total ?? 0;
  return { rows: out, axisEnd: ordinal(total) };
}

// ── company pills ───────────────────────────────────────────────────────────

const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv']);

/** 'Kawhi Leonard' → 'Leonard'; 'Derrick Jones Jr.' → 'Jones'; one-word names pass through. */
export function surname(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p && !SUFFIXES.has(p.toLowerCase()));
  return parts.length > 1 ? parts[parts.length - 1] : (parts[0] ?? name.trim());
}
