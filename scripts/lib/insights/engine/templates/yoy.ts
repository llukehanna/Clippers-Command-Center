// Year-over-year phrasings: team rank moves, record, player rises.
import { ordinal } from '../../proof-utils.js';
import type { Fact } from '../types.js';
import { overrides, pron, prevPhrase, prevSeasonLabel, rankText, sinceText, type ContextLine, type Headline, type TemplateModule } from './shared.js';

const pctWhole = (v: number | undefined) => `${Math.round((v ?? 0) * 100)}%`;

/** The player's previous value: numeric when the detector sets it, else read from its formatted text. */
const playerPrev = (f: Fact) => f.data.prev_value ?? parseFloat(f.data.prev_formatted ?? '');

/** Direction of a player move, read from the numbers (polarity says good or bad, not up or down). */
const playerMove = (f: Fact): 'rose' | 'fell' | 'held' | 'changed' => {
  const prev = playerPrev(f);
  if (Number.isNaN(prev)) return 'changed';
  if (f.value > prev) return 'rose';
  if (f.value < prev) return 'fell';
  return 'held';
};

const headline = (i: number): Headline => (f, rc) => {
  const d = f.data;
  if (d.yoy === 'team_rank') {
    const prev = d.prev_rank ?? 0;
    const cur = d.rank ?? 0;
    const prevText = rankText(prev, d.prev_tied);
    const curText = rankText(cur, d.tied);
    const both = `Clippers' ${d.label}: ${prevText} ${prevPhrase(rc)}, ${curText} ${rc.season.phrase}`;
    if (prev === cur) {
      // "held at tied for 3rd" reads badly: a tie in either season takes the two-season form.
      return i === 0 && !d.tied && !d.prev_tied ? `Clippers' ${d.label} held at ${ordinal(cur)} ${rc.season.phrase}` : both;
    }
    const verb = prev > cur ? 'improved' : 'slipped';
    return i === 0 ? `Clippers' ${d.label} ${verb} from ${prevText} ${prevPhrase(rc)} to ${curText} ${rc.season.phrase}` : both;
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
  const move = playerMove(f);
  if (move === 'held') {
    return i === 0
      ? `${f.subject.name}'s ${d.label} held steady at ${d.formatted} ${rc.season.phrase}`
      : `${f.subject.name}: ${d.prev_formatted} ${prevPhrase(rc)}, ${d.formatted} ${rc.season.phrase}`;
  }
  return i === 0
    ? `${f.subject.name}'s ${d.label} ${move} from ${d.prev_formatted} ${prevPhrase(rc)} to ${d.formatted} ${rc.season.phrase}`
    : `${f.subject.name}: ${d.prev_formatted} ${prevPhrase(rc)}, ${d.formatted} ${rc.season.phrase}`;
};

const detail: ContextLine = (f, _fr, rc) => {
  const d = f.data;
  if (d.yoy === 'team_rank') return `${d.prev_formatted} → ${d.formatted}${d.higherIsBetter === false ? ' (lower is better)' : ''}`;
  if (d.yoy === 'record') return `${d.wins}-${d.losses} vs ${d.prev_wins}-${d.prev_losses} (regular season)`;
  return `${d.prev_games} games ${prevPhrase(rc)} → ${d.games} games ${rc.season.phrase} (regular season)`;
};

/**
 * Context per frame, switched on what the fact measures. Win-percentage wording only
 * for record facts; career-best only for players; team rank facts never take frame wording.
 */
const context: ContextLine = (f, fr, rc, i) => {
  const d = f.data;
  const since = sinceText(fr);
  if (d.yoy === 'record') {
    if (fr.type === 'first_since' && since) return `Their best win percentage since ${since}`;
    if (fr.type === 'records_best' && fr.records_seasons !== undefined) {
      return `Their best win percentage in ${fr.records_seasons} season${fr.records_seasons === 1 ? '' : 's'} of records`;
    }
  }
  if (d.yoy === 'player') {
    if (fr.type === 'career_high') return 'A career-best season';
    if (fr.type === 'first_since' && since) return `${pron(f)} best ${d.label ?? 'performance'} since ${since}`;
    if (fr.type === 'records_best' && fr.records_seasons !== undefined) {
      return `${pron(f)} best ${d.label ?? 'performance'} in ${fr.records_seasons} season${fr.records_seasons === 1 ? '' : 's'} of records`;
    }
  }
  return detail(f, fr, rc, i);
};

export const yoyTemplates: TemplateModule = {
  default: overrides([headline(0), headline(1)], context),
};
