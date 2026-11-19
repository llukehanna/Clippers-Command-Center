// Player-page phrasings: season highs and milestone progress.
import { fmt } from '../../proof-utils.js';
import { fmtDate } from '../dates.js';
import { fmtNum, oppFull, oppShort, phrasings, type Headline, type TemplateModule } from './shared.js';

/** "season high" while the stats season is the current one; its label otherwise (a new season's first games read last season's box scores). */
const highName = (rc: Parameters<Headline>[1]) => (rc.season.isCurrent ? 'season high' : `${rc.season.label} high`);

const bestHeadline = (i: number): Headline => (f, rc) =>
  i === 0
    ? `${f.subject.name}'s ${highName(rc)}: ${f.value} ${f.data.unit} vs the ${oppShort(f, rc)}`
    : `${f.subject.name} set his ${highName(rc)} with ${f.value} ${f.data.unit}`;

export const seasonBestTemplates: TemplateModule = {
  default: phrasings([bestHeadline(0), bestHeadline(1)], (f, _fr, rc) => `${fmtDate(f.context.date)} vs the ${oppFull(f, rc)}`),
};

const SINGULAR: Record<string, string> = {
  points: 'point', rebounds: 'rebound', assists: 'assist', threes: 'three', 'made threes': 'made three', 'double-doubles': 'double-double',
};
/** "1 point", "18 points": the unit agrees with the count. */
export const unitFor = (n: number, unit: string) => (n === 1 ? (SINGULAR[unit] ?? unit) : unit);

const progressHeadline = (i: number): Headline => (f) => {
  const d = f.data;
  const unit = unitFor(d.remaining ?? 0, d.unit ?? '');
  const target = fmtNum(d.threshold ?? f.value);
  return i === 0
    ? `${f.subject.name} is ${d.remaining} ${unit} from ${target}${d.career ? ' for his career' : ' this season'}`
    : `${f.subject.name} needs ${d.remaining} more ${unit} for ${target}${d.career ? ' career' : ''}`;
};

export const milestoneProgressTemplates: TemplateModule = {
  default: phrasings([progressHeadline(0), progressHeadline(1)], (f) =>
    `${f.data.formatted} so far in ${f.data.games} games (${fmt(f.data.per_game ?? 0)} per game)`),
};
