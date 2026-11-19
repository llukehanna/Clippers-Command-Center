// Milestones passed in a game (postgame, past tense).
import { fmtDate } from '../dates.js';
import type { Fact } from '../types.js';
import { oppFull, oppShort, phrasings, type ContextLine, type Headline, type TemplateModule } from './shared.js';

/** "reached" when the total lands exactly on the threshold, "passed" when it went beyond. */
const verb = (f: Fact) => (f.data.total_value === f.value ? 'reached' : 'passed');

const headline = (i: number): Headline => (f, rc) => {
  const opp = oppShort(f, rc);
  const label = f.data.label ?? String(f.value);
  const v = verb(f);
  if (f.data.career) return i === 0 ? `${f.subject.name} ${v} ${label} for his career vs the ${opp}` : `${f.subject.name} ${v} ${label} in his career`;
  return i === 0 ? `${f.subject.name} ${v} ${label} for the season vs the ${opp}` : `${f.subject.name} ${v} ${label} ${rc.season.phrase} vs the ${opp}`;
};

/**
 * Never the headline again (FW-5): past the mark, the total he reached, dated so the frozen row stays true as he
 * adds to it; exactly on the mark, the total is the headline's own number, so the date and opponent instead.
 */
const detail: ContextLine = (f, _fr, rc) => {
  const total = f.data.total_value;
  if (total === undefined || total === f.value || !f.data.formatted) return `${fmtDate(f.context.date)} vs the ${oppFull(f, rc)}`;
  return `${f.data.formatted} ${f.data.career ? 'in his career' : `in ${rc.season.label}`} through ${fmtDate(f.context.date)}`;
};

export const milestoneCrossedTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], detail),
};
