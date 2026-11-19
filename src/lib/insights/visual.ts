// src/lib/insights/visual.ts
// Pure visual selection for an insight card. A visual whose inputs are missing
// is null (the card renders without it); nothing is guessed and headlines are
// never parsed. DB-free, relative imports only.
import { evidenceAria } from './evidence-aria';
import type { InsightCardData } from './card';
import { fmtDate, spanLabel, yearsBetween } from './time';
import type { TeamYoyRow } from './team-yoy';
import type { Evidence } from './types';

export type CardVisual =
  | { kind: 'gap'; from: string; to: string; span: string; ticks: number[]; then: string; now: string; aria: string }
  | { kind: 'best'; prev: number; now: number; aria: string }
  | { kind: 'company'; members: { name: string; date: string; me: boolean }[]; aria: string }
  | { kind: 'team_yoy'; rows: TeamYoyRow[]; aria: string }
  | { kind: 'evidence'; evidence: Evidence; aria: string };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

function gapVisual(card: InsightCardData): CardVisual | null {
  const f = card.frame;
  if (!f || f.type !== 'first_since') return null;
  const from = f.since_date;
  const to = card.fact_date;
  if (!isDate(from) || !isDate(to)) return null;
  if (from.slice(0, 10) >= to.slice(0, 10)) return null;
  const total = yearsBetween(from, to);
  const ticks: number[] = [];
  for (let y = Number(from.slice(0, 4)) + 1; y <= Number(to.slice(0, 4)); y++) {
    const t = yearsBetween(from, `${y}-01-01`) / total;
    if (t > 0 && t < 1) ticks.push(t);
  }
  const span = spanLabel(from, to);
  return {
    kind: 'gap', from, to, span, ticks, then: fmtDate(from), now: fmtDate(to),
    aria: `Last time ${fmtDate(from)}; this time ${fmtDate(to)}: ${span} apart`,
  };
}

function bestVisual(card: InsightCardData): CardVisual | null {
  const f = card.frame;
  if (!f || f.type !== 'career_high' || card.category === 'yoy_change') return null;
  if (!finite(f.prior_value) || !finite(f.value) || f.value <= f.prior_value) return null;
  return {
    kind: 'best', prev: f.prior_value, now: f.value,
    aria: `Previous best ${f.prior_value}, now ${f.value}`,
  };
}

function companyVisual(card: InsightCardData): CardVisual | null {
  const f = card.frame;
  if (!f || f.type !== 'joins_company' || !Array.isArray(f.names) || f.names.length === 0) return null;
  if (card.subject.kind !== 'player' || !card.fact_date) return null;
  const dates = new Map<string, string>();
  for (const r of f.proof_rows) {
    if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      if (typeof o.subject_name === 'string' && isDate(o.game_date) && !dates.has(o.subject_name)) {
        dates.set(o.subject_name, fmtDate(o.game_date));
      }
    }
  }
  const members: { name: string; date: string; me: boolean }[] = [];
  for (const name of f.names) {
    const date = dates.get(name);
    if (!date) return null;
    members.push({ name, date, me: false });
  }
  members.push({ name: card.subject.name, date: fmtDate(card.fact_date), me: true });
  return { kind: 'company', members, aria: members.map((m) => `${m.name}, ${m.date}`).join('; ') };
}

export function pickVisual(card: InsightCardData): CardVisual | null {
  const gap = gapVisual(card);
  if (gap) return gap;
  const best = bestVisual(card);
  if (best) return best;
  const company = companyVisual(card);
  if (company) return company;
  if (card.team_yoy && card.team_yoy.length > 0) {
    return {
      kind: 'team_yoy', rows: card.team_yoy,
      aria: card.team_yoy.map((r) => `${r.label}: ${r.from} to ${r.to} of ${r.total}`).join('; '),
    };
  }
  const ev = card.evidence;
  if (ev && ev.type !== 'history_ladder') return { kind: 'evidence', evidence: ev, aria: evidenceAria(ev) };
  return null;
}

export function bigFigure(v: CardVisual): { n: string; unit: string } | null {
  if (v.kind !== 'gap') return null;
  const y = yearsBetween(v.from, v.to);
  if (y >= 1) {
    const half = Math.round(y * 2) / 2;
    const whole = Math.floor(half);
    return { n: half % 1 ? `${whole}½` : String(whole), unit: whole === 1 && half % 1 === 0 ? 'year since the last one' : 'years since the last one' };
  }
  const mo = Math.round(y * 12);
  if (mo >= 12) return { n: '1', unit: 'year since the last one' };
  return { n: String(mo), unit: 'months since the last one' };
}
