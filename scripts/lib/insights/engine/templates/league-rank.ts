// League rank phrasings (team metrics and player metrics).
import { ordinal } from '../../proof-utils.js';
import { phrasings, type Headline, type TemplateModule } from './shared.js';

const headline = (i: number): Headline => (f, rc) => {
  const ord = ordinal(f.data.rank ?? f.value);
  const label = f.data.label ?? f.stat;
  const who = f.subject.type === 'team' ? 'Clippers' : f.subject.name;
  const verb = f.subject.type === 'team' ? 'rank' : 'ranks';
  const be = f.subject.type === 'team' ? 'are' : 'is';
  if (rc.season.isCurrent) {
    return i === 0 ? `${who} ${verb} ${ord} in the NBA in ${label} this season` : `${who} ${be} ${ord} in the NBA in ${label}`;
  }
  return i === 0 ? `${who} ranked ${ord} in the NBA in ${label} in ${rc.season.label}` : `${who} finished ${ord} in the NBA in ${label} in ${rc.season.label}`;
};

export const leagueRankTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f) => {
    const ord = ordinal(f.data.rank ?? f.value);
    if (f.subject.type === 'team') {
      return `${f.data.formatted} — ${ord} of ${f.data.total} teams${f.data.higherIsBetter === false ? ' (lower is better)' : ''}`;
    }
    return `${f.data.formatted} — ${ord} of ${f.data.total} qualified players (min ${f.data.min_games} games)`;
  }),
};
