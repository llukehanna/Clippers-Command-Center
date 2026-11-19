// Postgame team lines (past tense).
import { ordinal } from '../../proof-utils.js';
import { fmtDate } from '../dates.js';
import type { Fact } from '../types.js';
import { winLoss } from './player-line.js';
import { cap, oppShort, overrides, phrasings, rankSeason, sinceText, type ContextLine, type Headline, type RenderContext, type TemplateModule } from './shared.js';

type Words = ((f: Fact, rc: RenderContext) => string)[];
const WORDS: Record<string, Words> = {
  team_pts: [(f, rc) => `Clippers scored ${f.value} ${winLoss(f)} the ${oppShort(f, rc)}`, (f, rc) => `Clippers put up ${f.value} points vs the ${oppShort(f, rc)}`],
  team_fg3m: [(f, rc) => `Clippers made ${f.value} threes ${winLoss(f)} the ${oppShort(f, rc)}`, (f, rc) => `Clippers hit ${f.value} threes vs the ${oppShort(f, rc)}`],
  team_fg_pct: [(f, rc) => `Clippers shot ${f.data.formatted} from the field vs the ${oppShort(f, rc)}`, (f, rc) => `Clippers shot ${f.data.formatted} ${winLoss(f)} the ${oppShort(f, rc)}`],
  margin: [(f, rc) => `Clippers beat the ${oppShort(f, rc)} by ${f.value}`, (f, rc) => `Clippers won by ${f.value} vs the ${oppShort(f, rc)}`],
  loss_margin: [(f, rc) => `Clippers lost to the ${oppShort(f, rc)} by ${f.value}`, (f, rc) => `The ${oppShort(f, rc)} beat the Clippers by ${f.value}`],
  opp_pts_low: [(f, rc) => `Clippers held the ${oppShort(f, rc)} to ${f.value} points`, (f, rc) => `Clippers allowed just ${f.value} points to the ${oppShort(f, rc)}`],
};

/** "First ... since": the first time at or past this value. */
const FIRST: Record<string, (f: Fact) => string> = {
  team_pts: (f) => `First ${f.value}-point game`,
  team_fg3m: (f) => `First ${f.data.thing ?? `game with ${f.value}+ threes`}`,
  team_fg_pct: (f) => `First ${f.data.thing ?? `${f.data.formatted} shooting game`} or better`,
  margin: (f) => `First ${f.value}-point win`,
  loss_margin: (f) => `First ${f.value}-point loss`,
  opp_pts_low: (f) => `First ${f.data.thing ?? `game allowing ${f.value}`} or fewer`,
};

const headlines: Headline[] = [0, 1].map((i) => (f: Fact, rc: RenderContext) => WORDS[f.stat][i](f, rc));

/** League ranks go through rankSeason, so postgame reads "in {label} at the time" (never a hard-coded "this season"). */
const fallback: ContextLine = (f, fr, rc) => {
  if (fr.type === 'league_rank') {
    const best = f.data.best ?? 'best game';
    return (fr.rank ?? 1) === 1
      ? `${cap(best)} by any NBA team ${rankSeason(rc)}`
      : `The ${ordinal(fr.rank ?? 1)}-${best} by any NBA team ${rankSeason(rc)}`;
  }
  return `${fmtDate(f.context.date)}, ${f.context.home ? 'at home' : 'on the road'}`;
};

export const teamLineTemplates: TemplateModule = {
  default: phrasings(headlines, fallback),
  first_since: overrides(headlines, (f, fr) => {
    const lead = `${(FIRST[f.stat] ?? ((x: Fact) => `First ${x.data.thing ?? 'game like it'}`))(f)} by the Clippers`;
    const since = sinceText(fr);
    return since ? `${lead} since ${since}` : lead;
  }),
};
