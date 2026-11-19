// Last-10 form phrasings.
import { fmtDate } from '../dates.js';
import { phrasings, rankText, type Headline, type TemplateModule } from './shared.js';

const headline = (i: number): Headline => (f) => {
  const ord = rankText(f.data.rank ?? f.value, f.data.tied);
  return i === 0
    ? `Clippers rank ${ord} in ${f.data.label} over their last 10 games`
    : `Over their last 10, the Clippers rank ${ord} in ${f.data.label}`;
};

export const recentFormTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f) =>
    `${f.data.formatted} — ${rankText(f.data.rank ?? f.value, f.data.tied)} of ${f.data.total} teams (as of ${fmtDate(f.context.date)})`),
};
