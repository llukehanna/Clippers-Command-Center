// Next opponent's offense/defense rank (pregame, present tense).
import { ordinal } from '../../proof-utils.js';
import { phrasings, rankText, type Headline, type TemplateModule } from './shared.js';

const headline = (i: number): Headline => (f, rc) => {
  const side = f.data.side ?? 'defense';
  if ((f.data.tied ?? 0) > 0) {
    // "the tied-for-3rd-ranked defense" is not English: a tie reads "are tied for 3rd in defense".
    const are = rc.season.isCurrent ? 'are' : 'were';
    const ord = rankText(f.data.rank ?? f.value, f.data.tied);
    return i === 0
      ? `Up next: the ${f.subject.name} ${are} ${ord} in ${side} ${rc.season.phrase}`
      : `Next opponent: the ${f.subject.name} ${are} ${ord} in ${side}`;
  }
  const have = rc.season.isCurrent ? 'have' : 'had';
  const ord = ordinal(f.data.rank ?? f.value);
  return i === 0
    ? `Up next: the ${f.subject.name} ${have} the ${ord}-ranked ${side} ${rc.season.phrase}`
    : `Next opponent: the ${f.subject.name} ${have} the ${ord}-ranked ${side}`;
};

export const oppRankTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f) => {
    const defense = (f.data.side ?? 'defense') === 'defense';
    return `${defense ? 'Defensive' : 'Offensive'} rating ${f.data.formatted} — ${rankText(f.data.rank ?? f.value, f.data.tied)} of ${f.data.total}${defense ? ' (lower is better)' : ''}`;
  }),
};
