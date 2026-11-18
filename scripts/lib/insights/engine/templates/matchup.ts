// Pregame matchup phrasings (present tense): opponent form, hot opponents, rest, the line.
import { fmtDate } from '../dates.js';
import { oppFull, oppShort, phrasings, type Headline, type TemplateModule } from './shared.js';

const formHeadline = (i: number): Headline => (f) => {
  const opp = f.subject.name;
  const d = f.data;
  if (f.stat === 'opp_last10') {
    return i === 0 ? `The ${opp} are ${d.wins}-${d.losses} in their last 10` : `The ${opp} have gone ${d.wins}-${d.losses} over their last 10`;
  }
  if (d.winning) return i === 0 ? `The ${opp} have won ${f.value} straight` : `The ${opp} come in on a ${f.value}-game winning streak`;
  return i === 0 ? `The ${opp} have lost ${f.value} straight` : `The ${opp} come in having lost ${f.value} straight`;
};

export const oppFormTemplates: TemplateModule = {
  default: phrasings([formHeadline(0), formHeadline(1)], (f) => f.stat === 'opp_last10'
    ? `Current streak: ${f.data.winning ? 'W' : 'L'}${f.data.length}`
    : `${f.data.wins}-${f.data.losses} in their last ${(f.data.wins ?? 0) + (f.data.losses ?? 0)}`),
};

const hotHeadline = (i: number): Headline => (f, rc) =>
  i === 0
    ? `${f.subject.name} has ${f.data.noun} in ${f.value} straight for the ${oppShort(f, rc)}`
    : `Watch ${f.subject.name}: ${f.data.noun} in ${f.value} straight games`;

export const oppHotPlayerTemplates: TemplateModule = {
  default: phrasings([hotHeadline(0), hotHeadline(1)], (f) =>
    `${fmtDate(f.data.start_date ?? f.context.date)} to ${fmtDate(f.data.end_date ?? f.context.date)}`),
};

const days = (n: number | undefined) => `${n ?? 0} day${n === 1 ? '' : 's'}`;

const restHeadline = (i: number): Headline => (f, rc) => {
  if (f.stat === 'lac_b2b') return i === 0 ? 'Clippers play the second night of a back-to-back' : 'Back-to-back: the Clippers played last night';
  if (f.stat === 'opp_b2b') return i === 0 ? `The ${f.subject.name} are on the second night of a back-to-back` : `The ${f.subject.name} played last night`;
  return i === 0
    ? `Clippers have ${days(f.data.lac_rest)} of rest; the ${oppFull(f, rc)} have ${days(f.data.opp_rest)}`
    : `Rest: Clippers ${days(f.data.lac_rest)}, ${oppShort(f, rc)} ${days(f.data.opp_rest)}`;
};

export const restTemplates: TemplateModule = {
  default: phrasings([restHeadline(0), restHeadline(1)], (f, _fr, rc) => {
    const d = f.data;
    if (f.stat === 'lac_b2b') return `Last game: ${fmtDate(d.lac_last_game ?? f.context.date)}`;
    if (f.stat === 'opp_b2b') return `Their last game: ${fmtDate(d.opp_last_game ?? f.context.date)}`;
    return `Clippers last played ${fmtDate(d.lac_last_game ?? f.context.date)}; the ${oppShort(f, rc)} ${fmtDate(d.opp_last_game ?? f.context.date)}`;
  }),
};

const pts = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

const lineHeadline = (i: number): Headline => (f, rc) => {
  const spread = f.data.spread ?? f.value;
  const opp = oppShort(f, rc);
  if (spread === 0) return i === 0 ? `The line on Clippers vs the ${opp}: a pick'em` : `Clippers vs the ${opp} is a pick'em`;
  if (spread < 0) return i === 0 ? `Clippers are ${pts(-spread)}-point favorites vs the ${opp}` : `The line: Clippers by ${pts(-spread)} vs the ${opp}`;
  return i === 0 ? `Clippers are ${pts(spread)}-point underdogs vs the ${opp}` : `The line: the ${opp} by ${pts(spread)}`;
};

export const lineTemplates: TemplateModule = {
  default: phrasings([lineHeadline(0), lineHeadline(1)], (f) =>
    (f.data.total_points !== undefined ? `Over/under ${pts(f.data.total_points)}` : 'No total posted')),
};
