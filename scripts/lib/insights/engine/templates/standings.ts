// Standings phrasings (only notable conference ranks are emitted).
import { ordinal } from '../../proof-utils.js';
import { phrasings, type Headline, type TemplateModule } from './shared.js';

const headline = (i: number): Headline => (f, rc) => {
  const d = f.data;
  const conf = d.conference ?? 'conference';
  const ord = ordinal(d.rank ?? f.value);
  if (rc.season.isCurrent) {
    return i === 0 ? `Clippers are ${d.wins}-${d.losses}, ${ord} in the ${conf}` : `At ${d.wins}-${d.losses}, the Clippers are ${ord} in the ${conf}`;
  }
  return i === 0
    ? `Clippers finished ${rc.season.label} at ${d.wins}-${d.losses}, ${ord} in the ${conf}`
    : `Clippers went ${d.wins}-${d.losses} in ${rc.season.label}, ${ord} in the ${conf}`;
};

export const standingsTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f) =>
    `${ordinal(f.data.league_rank ?? 0)} of ${f.data.league_teams} teams league-wide by win percentage`),
};
