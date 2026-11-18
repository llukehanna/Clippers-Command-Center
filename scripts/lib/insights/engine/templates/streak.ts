// Streak phrasings: season/player surfaces, present perfect in season, past after it.
import { fmtDate } from '../dates.js';
import { phrasings, type Headline, type TemplateModule } from './shared.js';

type Words = { current: ((n: number) => string)[]; closed: ((n: number, s: string) => string)[] };

const PLAYER_WORDS: Record<string, Words> = {
  scoring_20: {
    current: [(n) => `has scored 20+ in ${n} straight games`, (n) => `has ${n} straight games with 20+ points`],
    closed: [(n, s) => `closed ${s} with 20+ points in ${n} straight games`, (n, s) => `ended ${s} with ${n} straight 20-point games`],
  },
  scoring_30: {
    current: [(n) => `has scored 30+ in ${n} straight games`, (n) => `has ${n} straight games with 30+ points`],
    closed: [(n, s) => `closed ${s} with 30+ points in ${n} straight games`, (n, s) => `ended ${s} with ${n} straight 30-point games`],
  },
  rebounding_10: {
    current: [(n) => `has 10+ rebounds in ${n} straight games`, (n) => `has ${n} straight games with 10+ rebounds`],
    closed: [(n, s) => `closed ${s} with 10+ rebounds in ${n} straight games`, (n, s) => `ended ${s} with ${n} straight 10-rebound games`],
  },
  threes_3: {
    current: [(n) => `has made 3+ threes in ${n} straight games`, (n) => `has ${n} straight games with 3+ threes`],
    closed: [(n, s) => `closed ${s} making 3+ threes in ${n} straight games`, (n, s) => `ended ${s} with ${n} straight games of 3+ threes`],
  },
  hot_shooting: {
    current: [(n) => `is shooting 50%+ from the field in ${n} straight games`, (n) => `has shot 50%+ in ${n} straight games`],
    closed: [(n, s) => `closed ${s} shooting 50%+ from the field in ${n} straight games`, (n, s) => `ended ${s} with ${n} straight 50% shooting games`],
  },
};

const TEAM_WORDS: Record<string, Words> = {
  wins: {
    current: [(n) => `Clippers have won ${n} straight`, (n) => `Clippers: ${n} straight wins`],
    closed: [(n, s) => `Clippers won ${n} straight in ${s}`, (n, s) => `Clippers: ${n} straight wins in ${s}`],
  },
  losses: {
    current: [(n) => `Clippers have lost ${n} straight`, (n) => `Clippers: ${n} straight losses`],
    closed: [(n, s) => `Clippers lost ${n} straight in ${s}`, (n, s) => `Clippers: ${n} straight losses in ${s}`],
  },
};

const headline = (i: number): Headline => (f, rc) => {
  const team = TEAM_WORDS[f.stat];
  if (team) return rc.season.isCurrent ? team.current[i](f.value) : team.closed[i](f.value, rc.season.label);
  const words = PLAYER_WORDS[f.stat];
  if (!words) throw new Error(`no streak wording for ${f.stat}`);
  return `${f.subject.name} ${rc.season.isCurrent ? words.current[i](f.value) : words.closed[i](f.value, rc.season.label)}`;
};

export const streakTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f, _fr, _rc, i) => {
    const start = fmtDate(f.data.start_date ?? f.context.date);
    return i === 0 ? `${start} to ${fmtDate(f.data.end_date ?? f.context.date)}` : `Since ${start}`;
  }),
};
