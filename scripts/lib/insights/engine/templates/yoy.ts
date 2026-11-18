// Year-over-year phrasings: team rank moves, record, player rises.
import { ordinal } from '../../proof-utils.js';
import { overrides, phrasings, prevPhrase, prevSeasonLabel, sinceText, type ContextLine, type Headline, type TemplateModule } from './shared.js';

const pctWhole = (v: number | undefined) => `${Math.round((v ?? 0) * 100)}%`;

const headline = (i: number): Headline => (f, rc) => {
  const d = f.data;
  if (d.yoy === 'team_rank') {
    const verb = (d.prev_rank ?? 0) > (d.rank ?? 0) ? 'improved' : 'slipped';
    return i === 0
      ? `Clippers' ${d.label} ${verb} from ${ordinal(d.prev_rank ?? 0)} ${prevPhrase(rc)} to ${ordinal(d.rank ?? 0)} ${rc.season.phrase}`
      : `Clippers' ${d.label}: ${ordinal(d.prev_rank ?? 0)} ${prevPhrase(rc)}, ${ordinal(d.rank ?? 0)} ${rc.season.phrase}`;
  }
  if (d.yoy === 'record') {
    const up = f.polarity === 'positive' ? 'up' : 'down';
    if (!rc.season.isCurrent) {
      return i === 0
        ? `Clippers won ${d.wins} games in ${rc.season.label}, ${up} from ${d.prev_wins} in ${prevSeasonLabel(rc)}`
        : `Clippers went ${d.wins}-${d.losses} in ${rc.season.label} after ${d.prev_wins}-${d.prev_losses} in ${prevSeasonLabel(rc)}`;
    }
    return i === 0
      ? `Clippers are winning ${pctWhole(d.cur_value)} of their games, ${up} from ${pctWhole(d.prev_value)} last season`
      : `Clippers' win rate is ${up} to ${pctWhole(d.cur_value)} from ${pctWhole(d.prev_value)} last season`;
  }
  return i === 0
    ? `${f.subject.name}'s ${d.label} rose from ${d.prev_formatted} ${prevPhrase(rc)} to ${d.formatted} ${rc.season.phrase}`
    : `${f.subject.name}: ${d.prev_formatted} ${prevPhrase(rc)}, ${d.formatted} ${rc.season.phrase}`;
};

const detail: ContextLine = (f, _fr, rc) => {
  const d = f.data;
  if (d.yoy === 'team_rank') return `${d.prev_formatted} → ${d.formatted}${d.higherIsBetter === false ? ' (lower is better)' : ''}`;
  if (d.yoy === 'record') return `${d.wins}-${d.losses} vs ${d.prev_wins}-${d.prev_losses} (regular season)`;
  return `${d.prev_games} games ${prevPhrase(rc)} → ${d.games} games ${rc.season.phrase} (regular season)`;
};

const framed: ContextLine = (f, fr, rc, i) => {
  if (fr.type === 'career_high') return 'A career-best season';
  if (fr.type === 'first_since') return f.data.yoy === 'record' ? `Their best win percentage since ${sinceText(fr)}` : `His best since ${sinceText(fr)}`;
  if (fr.type === 'records_best') return `Their best win percentage in ${fr.records_seasons ?? 1} seasons of records`;
  return detail(f, fr, rc, i);
};

const headlines = [headline(0), headline(1)];
export const yoyTemplates: TemplateModule = {
  default: phrasings(headlines, detail),
  career_high: overrides(headlines, framed),
  first_since: overrides(headlines, framed),
  records_best: overrides(headlines, framed),
};
