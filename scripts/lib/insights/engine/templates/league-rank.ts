// League rank phrasings (team metrics and player metrics).
import { phrasings, rankText, type Headline, type TemplateModule } from './shared.js';

const headline = (i: number): Headline => (f, rc) => {
  const tied = (f.data.tied ?? 0) > 0;
  const ord = rankText(f.data.rank ?? f.value, f.data.tied);
  const label = f.data.label ?? f.stat;
  const team = f.subject.type === 'team';
  const who = team ? 'Clippers' : f.subject.name;
  const verb = team ? 'rank' : 'ranks';
  const be = team ? 'are' : 'is';
  if (rc.season.isCurrent) {
    return i === 0 ? `${who} ${verb} ${ord} in the NBA in ${label} this season` : `${who} ${be} ${ord} in the NBA in ${label}`;
  }
  // "ranked tied for 3rd" reads badly: a past tie is "were tied for 3rd".
  const ranked = tied ? (team ? 'were' : 'was') : 'ranked';
  return i === 0 ? `${who} ${ranked} ${ord} in the NBA in ${label} in ${rc.season.label}` : `${who} finished ${ord} in the NBA in ${label} in ${rc.season.label}`;
};

export const leagueRankTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f) => {
    const ord = rankText(f.data.rank ?? f.value, f.data.tied);
    if (f.subject.type === 'team') {
      return `${f.data.formatted} — ${ord} of ${f.data.total} teams${f.data.higherIsBetter === false ? ' (lower is better)' : ''}`;
    }
    return `${f.data.formatted} — ${ord} of ${f.data.total} qualified players (min ${f.data.min_games} games)`;
  }),
};
