// Milestones passed in a game (postgame, past tense).
import type { Fact } from '../types.js';
import { oppShort, phrasings, type Headline, type TemplateModule } from './shared.js';

/** "reached" when the total lands exactly on the threshold, "passed" when it went beyond. */
const verb = (f: Fact) => (f.data.total_value === f.value ? 'reached' : 'passed');

const headline = (i: number): Headline => (f, rc) => {
  const opp = oppShort(f, rc);
  const label = f.data.label ?? String(f.value);
  const v = verb(f);
  if (f.data.career) return i === 0 ? `${f.subject.name} ${v} ${label} for his career vs the ${opp}` : `${f.subject.name} ${v} ${label} in his career`;
  return i === 0 ? `${f.subject.name} ${v} ${label} for the season vs the ${opp}` : `${f.subject.name} ${v} ${label} ${rc.season.phrase} vs the ${opp}`;
};

export const milestoneCrossedTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f, _fr, rc) =>
    `${f.data.formatted ?? f.data.total_value} ${f.data.career ? 'in his career' : rc.season.phrase}`),
};
