// Next opponent's offense/defense rank (pregame, present tense).
import { ordinal } from '../../proof-utils.js';
import { phrasings, type Headline, type TemplateModule } from './shared.js';

const headline = (i: number): Headline => (f, rc) => {
  const have = rc.season.isCurrent ? 'have' : 'had';
  const ord = ordinal(f.data.rank ?? f.value);
  const side = f.data.side ?? 'defense';
  return i === 0
    ? `Up next: the ${f.subject.name} ${have} the ${ord}-ranked ${side} ${rc.season.phrase}`
    : `Next opponent: the ${f.subject.name} ${have} the ${ord}-ranked ${side}`;
};

export const oppRankTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f) => {
    const defense = (f.data.side ?? 'defense') === 'defense';
    return `${defense ? 'Defensive' : 'Offensive'} rating ${f.data.formatted} — ${ordinal(f.data.rank ?? f.value)} of ${f.data.total}${defense ? ' (lower is better)' : ''}`;
  }),
};
