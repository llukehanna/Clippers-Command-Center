// Season series vs the next opponent.
import { oppFull, phrasings, type Headline, type TemplateModule } from './shared.js';

const headline = (i: number): Headline => (f, rc) => {
  const opp = oppFull(f, rc);
  const record = `${f.data.wins ?? 0}-${f.data.opp_wins ?? 0}`;
  if (rc.season.isCurrent) return i === 0 ? `Clippers are ${record} vs the ${opp} this season` : `Clippers vs the ${opp} this season: ${record}`;
  return i === 0 ? `Clippers went ${record} vs the ${opp} in ${rc.season.label}` : `Clippers vs the ${opp} in ${rc.season.label}: ${record}`;
};

export const h2hTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f) => {
    const m = f.data.meetings ?? 0;
    return `${m} meeting${m === 1 ? '' : 's'} (incl. postseason)`;
  }),
};
