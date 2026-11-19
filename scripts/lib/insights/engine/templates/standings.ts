// Standings phrasings (only notable conference ranks are emitted).
import { cap, phrasings, rankText, type Headline, type TemplateModule } from './shared.js';

const headline = (i: number): Headline => (f, rc) => {
  const d = f.data;
  const conf = d.conference ?? 'conference';
  const ord = rankText(d.rank ?? f.value, d.tied);
  if (rc.season.isCurrent) {
    return i === 0 ? `Clippers are ${d.wins}-${d.losses}, ${ord} in the ${conf}` : `At ${d.wins}-${d.losses}, the Clippers are ${ord} in the ${conf}`;
  }
  return i === 0
    ? `Clippers finished ${rc.season.label} at ${d.wins}-${d.losses}, ${ord} in the ${conf}`
    : `Clippers went ${d.wins}-${d.losses} in ${rc.season.label}, ${ord} in the ${conf}`;
};

export const standingsTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f) =>
    `${cap(rankText(f.data.league_rank ?? 0, f.data.league_tied))} of ${f.data.league_teams} teams league-wide by win percentage`),
};
