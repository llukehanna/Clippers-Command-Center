// A Clippers player's top-1% night league-wide (postgame, past tense).
import { ordinal } from '../../proof-utils.js';
import { fmtDate } from '../dates.js';
import { cap, oppShort, phrasings, type Headline, type TemplateModule } from './shared.js';

export const STAT_VERB: Record<string, (v: number) => string> = {
  pts: (v) => `scored ${v}`,
  reb: (v) => `grabbed ${v} rebounds`,
  ast: (v) => `had ${v} assists`,
  fg3m: (v) => `made ${v} threes`,
  stl: (v) => `had ${v} steals`,
  blk: (v) => `blocked ${v} shots`,
};

const headline = (i: number): Headline => (f, rc) => {
  const verb = STAT_VERB[f.stat]?.(f.value) ?? `had ${f.value}`;
  return i === 0
    ? `${f.subject.name} ${verb} vs the ${oppShort(f, rc)}`
    : `${f.subject.name}'s ${f.data.thing ?? 'big game'} vs the ${oppShort(f, rc)}`;
};

export const leagueNightTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f, fr, rc, i) => {
    if (fr.type === 'league_rank') {
      const r = fr.rank ?? f.data.rank ?? 1;
      const label = f.data.label ?? 'scoring';
      if (r === 1) return i === 0 ? `The best ${label} night in the NBA ${rc.season.phrase}` : `No bigger ${label} night in the NBA ${rc.season.phrase}`;
      return i === 0 ? `The ${ordinal(r)}-best ${label} night in the NBA ${rc.season.phrase}` : `${cap(ordinal(r))}-best ${label} night in the NBA ${rc.season.phrase}`;
    }
    return `${fmtDate(f.context.date)} — a ${f.context.result === 'W' ? 'win' : 'loss'}`;
  }),
};
