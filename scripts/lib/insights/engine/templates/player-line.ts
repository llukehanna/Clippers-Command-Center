// Postgame player lines and combos (past tense, with the result).
import { ordinal } from '../../proof-utils.js';
import { fmtDate } from '../dates.js';
import type { Fact } from '../types.js';
import { cap, oppFull, oppShort, phrasings, rankSeason, type Headline, type TemplateModule } from './shared.js';

export const STAT_VERB: Record<string, (v: number) => string> = {
  pts: (v) => `scored ${v}`,
  reb: (v) => `grabbed ${v} rebounds`,
  ast: (v) => `had ${v} assists`,
  fg3m: (v) => `made ${v} threes`,
  stl: (v) => `had ${v} steals`,
  blk: (v) => `blocked ${v} shots`,
};

export const winLoss = (f: Fact) => (f.context.result === 'W' ? 'in a win over' : 'in a loss to');

const lineHeadline = (i: number): Headline => (f, rc) => {
  const verb = STAT_VERB[f.stat]?.(f.value) ?? `had ${f.value}`;
  return i === 0
    ? `${f.subject.name} ${verb} ${winLoss(f)} the ${oppShort(f, rc)}`
    : `${f.subject.name}: ${f.value} ${f.data.unit ?? 'points'} vs the ${oppShort(f, rc)}`;
};

export const playerLineTemplates: TemplateModule = {
  default: phrasings([lineHeadline(0), lineHeadline(1)], (f, fr, rc, i) => {
    if (fr.type === 'league_rank') {
      const r = fr.rank ?? 1;
      const label = f.data.label ?? 'scoring';
      const when = rankSeason(rc);
      if (r === 1) return i === 0 ? `The best ${label} night in the NBA ${when}` : `No bigger ${label} night in the NBA ${when}`;
      return i === 0 ? `The ${ordinal(r)}-best ${label} night in the NBA ${when}` : `${cap(ordinal(r))}-best ${label} night in the NBA ${when}`;
    }
    return `${fmtDate(f.context.date)} vs the ${oppFull(f, rc)}`;
  }),
};

const comboHeadline = (i: number): Headline => (f, rc) =>
  i === 0
    ? `${f.subject.name} posted a ${f.data.thing} vs the ${oppShort(f, rc)}`
    : `${f.subject.name} had ${f.data.line} vs the ${oppShort(f, rc)}`;

export const playerComboTemplates: TemplateModule = {
  default: phrasings([comboHeadline(0), comboHeadline(1)], (f) => `${cap(f.data.line ?? '')} in ${f.context.result === 'W' ? 'a win' : 'a loss'}`),
};
