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
/** Short span start ("Jan 2024" or a season label); '' when the frame has neither field. */
export const sinceText = (fr: Frame) => fr.since_label ?? (fr.since_date ? monthYear(fr.since_date) : '');
/** Long span start ("Mar 1, 2021" or a season label); '' when the frame has neither field. */
const sinceLong = (fr: Frame) => fr.since_label ?? (fr.since_date ? fmtDate(fr.since_date) : '');

/**
 * Postgame rows are frozen once written, so a context line that a later game can overturn (a record, a rank, a
 * high, "the only") says it held at the time (FW-3). Season, player and pregame rows are rewritten nightly and
 * stay current, so they are not anchored.
 */
export const frozen = (rc: RenderContext) => rc.surface === 'postgame';
export const atTheTime = (rc: RenderContext) => (frozen(rc) ? ' at the time' : '');
/**
 * A rank as copy: "13th", or "tied for 13th" when others share it (SQL RANK() gives the tie its top place). A tie for
 * 1st reads "tied for 1st", never "1st" alone (FF-1).
 */
export const rankText = (rank: number, tied?: number) => (tied && tied > 0 ? `tied for ${ordinal(rank)}` : ordinal(rank));

/** A league rank's season: rc.season.phrase while current; "in 2026-27 at the time" on a frozen postgame row. */
export const rankSeason = (rc: RenderContext) => (frozen(rc) ? `in ${rc.season.label} at the time` : rc.season.phrase);

/**
 * Context line for the frame types every kind words the same way; null for kind-specific
 * types and when the frame lacks the field the line needs (a null lets the fallback speak).
 */
export function frameLine(f: Fact, fr: Frame, rc: RenderContext, variant: number): string | null {
  const thing = f.data.thing ?? 'performance';
  const best = f.data.best ?? `best ${thing}`;
  const by = f.data.by ?? (f.subject.type === 'player' ? 'by a Clipper' : 'by the Clippers');
  const label = fr.records_label || null;
  const since = sinceText(fr) || null;
  const sinceFull = sinceLong(fr) || null;
  const seasonsText = fr.records_seasons !== undefined
    ? `${fr.records_seasons} season${fr.records_seasons === 1 ? '' : 's'} of records`
    : null;
  /** The variant-th option among those whose fields are present. */
  const pick = (options: (string | null)[]): string | null => {
    const ok = options.filter((o): o is string => o !== null);
    return ok.length ? ok[variant % ok.length] : null;
  };
  const then = atTheTime(rc);
  switch (fr.type) {
    case 'career_high': {
      const prev = fr.prior_value !== undefined ? ` (previous best ${fmtNum(fr.prior_value)})` : '';
      return frozen(rc)
        ? pick(prev ? [`A new career high${prev}`, `A career high at the time${prev}`] : [`A career high at the time`, `${pron(f)} career best at the time`])
        : pick([`A career high${prev}`, `${pron(f)} career best`]);
    }
    case 'only_one':
      return label ? pick([`The only ${thing} ${by} since ${label}${then}`, `No other ${thing} ${by} since ${label}${then}`]) : null;
    case 'records_best':
      return pick([
        label ? `${cap(best)} ${by} since ${label}${then}` : null,
        seasonsText ? `${cap(best)} ${by} in ${seasonsText}${then}` : null,
      ]);
    case 'joins_company':
      return label && fr.names?.length
        ? pick([`${frozen(rc) ? 'Joined' : 'Joins'} ${listNames(fr.names)} as the only Clippers with a ${thing} since ${label}${then}`])
        : null;
    case 'first_since':
      // Every variant names the thing: "His first since Mar 26, 2018" leaves out what is first (FW-4).
      return fr.who === 'subject'
        ? pick([since ? `${pron(f)} first ${thing} since ${since}` : null, sinceFull ? `${pron(f)} first ${thing} since ${sinceFull}` : null])
        : pick([since ? `First ${thing} ${by} since ${since}` : null, sinceFull ? `The first ${thing} ${by} since ${sinceFull}` : null]);
    case 'longest_since':
      return pick([since ? `${cap(best)} ${by} since ${since}` : null, sinceFull ? `The ${best} ${by} since ${sinceFull}` : null]);
    case 'clippers_rank':
      return label && fr.rank !== undefined ? pick([`${ordinal(fr.rank)}-${best} ${by} since ${label}${then}`]) : null;
    case 'season_high':
      // Postgame: rc.season.phrase is "so far in {label}", which anchors the high in time.
      return fr.who === 'subject'
        ? pick([frozen(rc) ? `${pron(f)} season high ${rc.season.phrase}` : `${pron(f)} season high`, `${pron(f)} ${best} ${rc.season.phrase}`])
        : pick([`The ${best} ${by} ${rc.season.phrase}`, `${cap(best)} ${by} ${rc.season.phrase}`]);
    case 'nth_time':
      return fr.count !== undefined
        ? pick([`${pron(f)} ${ordinal(fr.count)} ${thing} ${rc.season.phrase}`, `${ordinal(fr.count)} ${thing} ${rc.season.phrase}`])
        : null;
    default:
      return null;
  }
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
