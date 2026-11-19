// Postgame quarters, halves and clutch time (play-by-play). Past tense.
// Season wording comes from frameLine (rc.season.phrase), never a hard-coded "this season".
import { ordinal } from '../../proof-utils.js';
import { fmtDate } from '../dates.js';
import type { Fact } from '../types.js';
import { oppFull, oppShort, phrasings, type ContextLine, type Headline, type TemplateModule } from './shared.js';

const halfWord = (f: Fact) => (f.window.period === 2 ? 'second' : 'first');
const quarterWord = (f: Fact) => ordinal(f.window.period ?? 1);

const playerHeadline = (i: number): Headline => (f, rc) => {
  const opp = oppShort(f, rc);
  if (f.stat === 'half_pts') {
    return i === 0
      ? `${f.subject.name} scored ${f.value} in the ${halfWord(f)} half vs the ${opp}`
      : `${f.subject.name}: ${f.value} points in the ${halfWord(f)} half vs the ${opp}`;
  }
  return i === 0
    ? `${f.subject.name} scored ${f.value} in the ${quarterWord(f)} quarter vs the ${opp}`
    : `${f.subject.name}: ${f.value} points in the ${quarterWord(f)} quarter vs the ${opp}`;
};

const teamHeadline = (i: number): Headline => (f, rc) =>
  i === 0
    ? `Clippers scored ${f.value} in the ${quarterWord(f)} quarter vs the ${oppShort(f, rc)}`
    : `A ${f.value}-point ${quarterWord(f)} quarter for the Clippers vs the ${oppShort(f, rc)}`;

const clutchHeadline = (i: number): Headline => (f, rc) =>
  i === 0
    ? `${f.subject.name} scored ${f.value} in clutch time vs the ${oppShort(f, rc)}`
    : `${f.subject.name}: ${f.value} clutch points vs the ${oppShort(f, rc)}`;

const dateLine: ContextLine = (f, _fr, rc) => `${fmtDate(f.context.date)} vs the ${oppFull(f, rc)}`;

/**
 * Clutch time is the last 5:00 of the 4th quarter and overtime with the game within 5 points: "in clutch time", not "the last five minutes".
 * Parts with no attempts are left out ("0-of-0 at the line" says nothing).
 */
const clutchLine: ContextLine = (f, fr, rc, i) => {
  const parts = [
    (f.data.fga ?? 0) > 0 ? `${f.data.fgm ?? 0}-of-${f.data.fga} from the field` : null,
    (f.data.fta ?? 0) > 0 ? `${f.data.ftm ?? 0}-of-${f.data.fta} at the line` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? `${parts.join(', ')} in clutch time` : dateLine(f, fr, rc, i);
};

export const playerPeriodTemplates: TemplateModule = { default: phrasings([playerHeadline(0), playerHeadline(1)], dateLine) };
export const teamPeriodTemplates: TemplateModule = { default: phrasings([teamHeadline(0), teamHeadline(1)], dateLine) };
export const clutchTemplates: TemplateModule = { default: phrasings([clutchHeadline(0), clutchHeadline(1)], clutchLine) };
