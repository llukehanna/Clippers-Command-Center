// scripts/lib/insights/engine/templates/shared.ts
// Phrasing types and the context lines every fact kind words the same way
// (spec §2.5). Pure.
import type { Frame, FrameType, Surface } from '../../../../../src/lib/insights/types';
import { seasonLabel } from '../../../schedule-utils.js';
import { ordinal } from '../../proof-utils.js';
import { fmtDate, monthYear } from '../dates.js';
import type { Fact, InsightSeason, TeamInfo } from '../types.js';

export interface RenderContext { surface: Surface; season: InsightSeason; teams: Map<string, TeamInfo> }
export interface Rendered { headline: string; context: string }
export type Phrasing = (fact: Fact, frame: Frame, rc: RenderContext) => Rendered;
export type TemplateModule = { default: Phrasing[] } & Partial<Record<FrameType, Phrasing[]>>;
export type Headline = (f: Fact, rc: RenderContext) => string;
export type ContextLine = (f: Fact, fr: Frame, rc: RenderContext, variant: number) => string;

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const fmtNum = (v: number) => (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(1));
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
export const pron = (f: Fact) => (f.subject.type === 'player' ? 'His' : 'Their');
export const oppFull = (f: Fact, rc: RenderContext) =>
  rc.teams.get(f.context.opponent_id ?? '')?.fullName ?? f.context.opponent_name ?? 'opponent';
export const oppShort = (f: Fact, rc: RenderContext) =>
  rc.teams.get(f.context.opponent_id ?? '')?.name ?? f.context.opponent_name ?? 'opponent';
export const prevSeasonLabel = (rc: RenderContext) => seasonLabel(rc.season.id - 1);
export const prevPhrase = (rc: RenderContext) => (rc.season.isCurrent ? 'last season' : `in ${prevSeasonLabel(rc)}`);
export const sinceText = (fr: Frame) => fr.since_label ?? (fr.since_date ? monthYear(fr.since_date) : '');
const since = sinceText;
const sinceLong = (fr: Frame) => fr.since_label ?? (fr.since_date ? fmtDate(fr.since_date) : '');

/** Context line for the frame types every kind words the same way; null for kind-specific types. */
export function frameLine(f: Fact, fr: Frame, rc: RenderContext, variant: number): string | null {
  const thing = f.data.thing ?? 'performance';
  const best = f.data.best ?? `best ${thing}`;
  const by = f.data.by ?? (f.subject.type === 'player' ? 'by a Clipper' : 'by the Clippers');
  const label = fr.records_label ?? '';
  const seasons = fr.records_seasons ?? 1;
  const lines: Partial<Record<FrameType, string[]>> = {
    career_high: [
      `A career high${fr.prior_value !== undefined ? ` (previous best ${fmtNum(fr.prior_value)})` : ''}`,
      `${pron(f)} career best`,
    ],
    only_one: [`The only ${thing} ${by} since ${label}`, `No other ${thing} ${by} since ${label}`],
    records_best: [
      `${cap(best)} ${by} since ${label}`,
      `${cap(best)} ${by} in ${seasons} season${seasons === 1 ? '' : 's'} of records`,
    ],
    joins_company: [`Joins ${listNames(fr.names ?? [])} as the only Clippers with a ${thing} since ${label}`],
    first_since: fr.who === 'subject'
      ? [`${pron(f)} first ${thing} since ${since(fr)}`, `${pron(f)} first since ${sinceLong(fr)}`]
      : [`First ${thing} ${by} since ${since(fr)}`, `The first ${thing} ${by} since ${sinceLong(fr)}`],
    longest_since: [`${cap(best)} ${by} since ${since(fr)}`, `The ${best} ${by} since ${sinceLong(fr)}`],
    clippers_rank: [`${ordinal(fr.rank ?? 0)}-${best} ${by} since ${label}`],
    season_high: fr.who === 'subject'
      ? [`${pron(f)} season high`, `${pron(f)} ${best} ${rc.season.phrase}`]
      : [`The ${best} ${by} ${rc.season.phrase}`, `${cap(best)} ${by} ${rc.season.phrase}`],
    nth_time: [`${pron(f)} ${ordinal(fr.count ?? 0)} ${thing} ${rc.season.phrase}`, `${ordinal(fr.count ?? 0)} ${thing} ${rc.season.phrase}`],
  };
  const options = lines[fr.type];
  return options ? options[variant % options.length] : null;
}

/** One phrasing per headline; the context is the shared frame line, else `fallback`. */
export function phrasings(headlines: Headline[], fallback: ContextLine): Phrasing[] {
  return headlines.map((headline, i) => (f, fr, rc) => ({
    headline: headline(f, rc),
    context: frameLine(f, fr, rc, i) ?? fallback(f, fr, rc, i),
  }));
}

/** One phrasing per headline with a kind-specific context for every frame. */
export function overrides(headlines: Headline[], context: ContextLine): Phrasing[] {
  return headlines.map((headline, i) => (f, fr, rc) => ({ headline: headline(f, rc), context: context(f, fr, rc, i) }));
}
