// scripts/dev/seed-franchise-fixture.ts
// Illustrative fixture for local UI checks. Not authoritative history; the real data comes
// from scripts/import-franchise-history.ts.
//
// Fills a throwaway local Postgres with realistic-looking franchise-history rows so the
// /franchise pages can be checked in a browser before the real import exists. Names, dates,
// scores and amounts are made up or loosely based on real events; descriptions are our own
// short generated-style sentences.
//
// DESTRUCTIVE: truncates the franchise tables and every table it seeds (CASCADE). It refuses
// to run unless DATABASE_URL points at 127.0.0.1 / localhost on port 55498, the throwaway
// Docker Postgres for this work (never 55499, never 55432, never a remote host).
//
// Idempotent: running it twice leaves the same database.
//
// Run: npm run seed:franchise-fixture [-- --empty]
//   (= node --env-file-if-exists=.env.local node_modules/.bin/tsx scripts/dev/seed-franchise-fixture.ts)
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { NBA_TEAM_IDS } from '../lib/nba-teams.js';

// ── Safety guard ─────────────────────────────────────────────────────────────

const ALLOWED_HOSTS = ['127.0.0.1', 'localhost'];
const ALLOWED_PORT = '55498';

function guardedUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error('Refusing to run: DATABASE_URL is not set.');
    process.exit(1);
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    console.error('Refusing to run: DATABASE_URL is not a valid URL.');
    process.exit(1);
  }
  if (!ALLOWED_HOSTS.includes(u.hostname) || u.port !== ALLOWED_PORT) {
    console.error(
      `Refusing to run: this script wipes tables and only runs against the throwaway local database ` +
        `(host ${ALLOWED_HOSTS.join(' or ')}, port ${ALLOWED_PORT}). Got host "${u.hostname}", port "${u.port || '(default)'}".`,
    );
    process.exit(1);
  }
  return raw;
}

// --empty: schema + reference tables (teams, seasons, team_seasons, players, games) only; all 12
// franchise tables stay empty, to check the pages' empty states.
const EMPTY = process.argv.includes('--empty');

const sql = postgres(guardedUrl(), { max: 1, connect_timeout: 10, onnotice: () => {} });

// ── Helpers ──────────────────────────────────────────────────────────────────

type Tri = keyof typeof NBA_TEAM_IDS | 'LAC';
const fid = (t: Tri): number => NBA_TEAM_IDS[t];
const LAC: Tri = 'LAC';

/** Same rule as src/lib/season.ts calendarSeasonId: seasons roll over on July 1. */
function seasonOf(date: string): number {
  const [y, m] = date.split('-').map(Number);
  return m <= 6 ? y - 1 : y;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ── Teams, eras ──────────────────────────────────────────────────────────────

// Alphabetical by tricode, so the Clippers are internal team 13 like production.
const TEAMS: Array<[Tri, string, string, 'East' | 'West']> = [
  ['ATL', 'Atlanta', 'Hawks', 'East'], ['BOS', 'Boston', 'Celtics', 'East'], ['BKN', 'Brooklyn', 'Nets', 'East'],
  ['CHA', 'Charlotte', 'Hornets', 'East'], ['CHI', 'Chicago', 'Bulls', 'East'], ['CLE', 'Cleveland', 'Cavaliers', 'East'],
  ['DAL', 'Dallas', 'Mavericks', 'West'], ['DEN', 'Denver', 'Nuggets', 'West'], ['DET', 'Detroit', 'Pistons', 'East'],
  ['GSW', 'Golden State', 'Warriors', 'West'], ['HOU', 'Houston', 'Rockets', 'West'], ['IND', 'Indiana', 'Pacers', 'East'],
  ['LAC', 'LA', 'Clippers', 'West'], ['LAL', 'Los Angeles', 'Lakers', 'West'], ['MEM', 'Memphis', 'Grizzlies', 'West'],
  ['MIA', 'Miami', 'Heat', 'East'], ['MIL', 'Milwaukee', 'Bucks', 'East'], ['MIN', 'Minnesota', 'Timberwolves', 'West'],
  ['NOP', 'New Orleans', 'Pelicans', 'West'], ['NYK', 'New York', 'Knicks', 'East'], ['OKC', 'Oklahoma City', 'Thunder', 'West'],
  ['ORL', 'Orlando', 'Magic', 'East'], ['PHI', 'Philadelphia', '76ers', 'East'], ['PHX', 'Phoenix', 'Suns', 'West'],
  ['POR', 'Portland', 'Trail Blazers', 'West'], ['SAC', 'Sacramento', 'Kings', 'West'], ['SAS', 'San Antonio', 'Spurs', 'West'],
  ['TOR', 'Toronto', 'Raptors', 'East'], ['UTA', 'Utah', 'Jazz', 'West'], ['WAS', 'Washington', 'Wizards', 'East'],
];

interface Era { city: string; name: string; abbr: string }

/** Era name of a franchise (keyed by its current tricode) in a season. */
function eraFor(tri: Tri, s: number): Era {
  switch (tri) {
    case 'LAC':
      if (s <= 1977) return { city: 'Buffalo', name: 'Braves', abbr: 'BUF' };
      if (s <= 1983) return { city: 'San Diego', name: 'Clippers', abbr: 'SDC' };
      if (s <= 2014) return { city: 'Los Angeles', name: 'Clippers', abbr: 'LAC' };
      return { city: 'LA', name: 'Clippers', abbr: 'LAC' };
    case 'OKC':
      return s <= 2007
        ? { city: 'Seattle', name: 'SuperSonics', abbr: 'SEA' }
        : { city: 'Oklahoma City', name: 'Thunder', abbr: 'OKC' };
    case 'BKN':
      return s <= 2011
        ? { city: 'New Jersey', name: 'Nets', abbr: 'NJN' }
        : { city: 'Brooklyn', name: 'Nets', abbr: 'BKN' };
    case 'CHA':
      return s <= 2013
        ? { city: 'Charlotte', name: 'Bobcats', abbr: 'CHA' }
        : { city: 'Charlotte', name: 'Hornets', abbr: 'CHA' };
    case 'NOP':
      return s <= 2012
        ? { city: 'New Orleans', name: 'Hornets', abbr: 'NOH' }
        : { city: 'New Orleans', name: 'Pelicans', abbr: 'NOP' };
    default: {
      const t = TEAMS.find((x) => x[0] === tri)!;
      return { city: t[1], name: t[2], abbr: tri };
    }
  }
}

const ERA_NAMES: Array<[Tri, number, number | null]> = [
  ['LAC', 1970, 1977], ['LAC', 1978, 1983], ['LAC', 1984, 2014], ['LAC', 2015, null],
  ['OKC', 1967, 2007], ['OKC', 2008, null],
  ['BKN', 1970, 2011], ['BKN', 2012, null],
  ['CHA', 2004, 2013], ['CHA', 2014, null],
  ['NOP', 2002, 2012], ['NOP', 2013, null],
];

// Clippers records that read plausibly; every other (season, franchise) is hash-derived.
const LAC_RECORDS: Record<number, [number, number]> = {
  2016: [53, 29], 2017: [42, 40], 2018: [48, 34], 2019: [49, 23], 2020: [47, 25],
  2021: [42, 40], 2022: [44, 38], 2023: [51, 31], 2024: [50, 32], 2025: [36, 46],
};

// ── People ───────────────────────────────────────────────────────────────────

interface Person {
  key: string;
  kind: 'player' | 'coach' | 'executive';
  name: string;
  birth?: string;
  nbaId?: number;
  /** Gets a players row, so /players/<player_id> works. */
  page?: { first: string; last: string; pos: string; heightIn: number; weightLb: number };
}

const people: Person[] = [];
const person = (key: string, kind: Person['kind'], name: string, birth?: string, nbaId?: number, page?: Person['page']) =>
  people.push({ key, kind, name, birth, nbaId, page });

// Players with a player page
person('leonaka01', 'player', 'Kawhi Leonard', '1991-06-29', 202695, { first: 'Kawhi', last: 'Leonard', pos: 'F', heightIn: 79, weightLb: 225 });
person('hardeja01', 'player', 'James Harden', '1989-08-26', 201935, { first: 'James', last: 'Harden', pos: 'G', heightIn: 77, weightLb: 220 });
person('zubaciv01', 'player', 'Ivica Zubac', '1997-03-18', 1627826, { first: 'Ivica', last: 'Zubac', pos: 'C', heightIn: 84, weightLb: 240 });
person('georgpa01', 'player', 'Paul George', '1990-05-02', 202331, { first: 'Paul', last: 'George', pos: 'F', heightIn: 80, weightLb: 220 });
person('mannte01', 'player', 'Terance Mann', '1996-10-18', 1629611, { first: 'Terance', last: 'Mann', pos: 'G', heightIn: 77, weightLb: 215 });
// Players without a page
for (const [key, name, birth, nba] of [
  ['gilgesh01', 'Shai Gilgeous-Alexander', '1998-07-12', 1628983],
  ['gallida01', 'Danilo Gallinari', '1988-08-08', 201568],
  ['paulch01', 'Chris Paul', '1985-05-06', 101108],
  ['beverpa01', 'Patrick Beverley', '1988-07-12', 201976],
  ['willilo02', 'Lou Williams', '1986-10-27', 101150],
  ['harremo01', 'Montrezl Harrell', '1994-01-26', 1626149],
  ['dekkesa01', 'Sam Dekker', '1994-05-06', 1626155],
  ['liggide01', 'DeAndre Liggins', '1988-05-31', 202720],
  ['hilliar01', 'Darrun Hilliard', '1993-04-13', 1626199],
  ['kennalu01', 'Luke Kennard', '1996-06-24', 1628379],
  ['mcgruro01', 'Rodney McGruder', '1991-07-29', 1627763],
  ['wrighde01', 'Delon Wright', '1992-04-26', 1626153],
  ['batumni01', 'Nicolas Batum', '1988-12-14', 201587],
  ['morrima02', 'Marcus Morris', '1989-09-02', 202694],
  ['covinro01', 'Robert Covington', '1990-12-14', 203496],
  ['martike01', 'KJ Martin', '2000-12-01', 1630231],
  ['tuckepj01', 'P.J. Tucker', '1985-05-05', 200782],
  ['petrufi01', 'Filip Petrusev', '2000-04-15', 1630217],
  ['bealbr01', 'Bradley Beal', '1993-06-28', 203078],
  ['lopezbr01', 'Brook Lopez', '1988-04-01', 201572],
  ['brownko01', 'Kobe Brown', '1999-03-12', 1631235],
  ['primojo01', 'Joshua Primo', '2002-12-24', 1630563],
  ['gordoaa01', 'Aaron Gordon', '1995-09-16', 203932],
  ['harriga01', 'Gary Harris', '1994-09-14', 203914],
  ['hamptrj01', 'RJ Hampton', '2001-02-07', 1630181],
  ['kaufmbo01', 'Bob Kauffman', '1945-07-01', undefined],
  ['tolsode01', 'Dean Tolson', '1951-11-12', undefined],
  ['smithel01', 'Elmore Smith', '1949-05-26', undefined],
  ['cummite01', 'Terry Cummings', '1961-03-15', undefined],
  ['mannida01', 'Danny Manning', '1966-05-17', undefined],
  ['griffbl01', 'Blake Griffin', '1989-03-16', 201933],
  ['irvinky01', 'Kyrie Irving', '1992-03-23', 202681],
  ['robinje01', 'Jerome Robinson', '1997-02-22', 1629010],
  ['prestja01', 'Jason Preston', '1999-10-26', 1630554],
  ['parkeja01', 'Jabari Parker', '1995-03-15', 203953],
  ['ewingpa01', 'Patrick Ewing', '1962-08-05', undefined],
  ['russeda01', "D'Angelo Russell", '1996-02-23', 1626156],
  ['johnsma01', 'Marques Johnson', '1956-02-08', undefined],
  ['nixonno01', 'Norm Nixon', '1955-10-11', undefined],
  ['smithde01', 'Derek Smith', '1961-11-01', undefined],
  ['waltobi01', 'Bill Walton', '1952-11-05', undefined],
  ['russebi01', 'Bill Russell', '1934-02-12', undefined],
  ['baylore01', 'Elgin Baylor', '1934-09-16', undefined],
  ['mcadobo01', 'Bob McAdoo', '1951-09-25', undefined],
  ['wilkido01', 'Dominique Wilkins', '1960-01-12', undefined],
  ['wrighlo01', 'Lorenzen Wright', '1975-11-04', undefined],
  ['name:jordan-miller-1998', 'Jordan Miller', '1998-07-04', undefined],
  ['name:kai-jones-2001', 'Kai Jones', '2001-01-05', undefined],
  ['name:kobe-sanders-2002', 'Kobe Sanders', '2002-05-06', undefined],
  ['name:alex-hartwell-1999', 'Alex Hartwell', '1999-09-03', undefined],
] as Array<[string, string, string, number | undefined]>) {
  person(key, 'player', name, birth, nba);
}
// Coaches
person('schaydo01', 'coach', 'Dolph Schayes', '1928-05-19');
person('ramsaja99', 'coach', 'Jack Ramsay', '1925-02-21');
person('gentral01', 'coach', 'Alvin Gentry', '1954-11-05');
person('dunlemi01', 'coach', 'Mike Dunleavy', '1954-09-15');
person('riverdo01', 'coach', 'Doc Rivers', '1961-10-13');
person('luety01', 'coach', 'Tyronn Lue', '1977-05-03');
person('name:larry-brown-1940', 'coach', 'Larry Brown', '1940-09-14');
// Executives
person('name:lawrence-frank-1970', 'executive', 'Lawrence Frank', '1970-03-07');
person('name:michael-winger-1982', 'executive', 'Michael Winger', '1982-01-01');

// ── Picks and swaps ──────────────────────────────────────────────────────────

interface PickDef {
  year: number; round: number; orig: Tri;
  known?: boolean | null; text?: string | null; prot?: unknown;
  status: 'future' | 'used' | 'conveyed_as_other' | 'extinguished' | 'forfeited';
  overall?: number; selected?: string; owner?: Tri;
}
const pickRef = (year: number, round: number, orig: Tri) => `${year}-${round}-${orig}`;
const picks: PickDef[] = [
  // Paul George trade (2019): LAC firsts and a MIA first, sent to OKC
  { year: 2022, round: 1, orig: 'LAC', known: true, text: 'Top-14 protected', prot: [{ year: 2022, range: '1-14', then: 'No pick conveyed; obligation rolls to a later year' }], status: 'used', overall: 25, owner: 'OKC' },
  { year: 2024, round: 1, orig: 'LAC', known: true, status: 'used', overall: 29, owner: 'OKC' },
  { year: 2026, round: 1, orig: 'LAC', known: true, status: 'used', overall: 19, owner: 'OKC' },
  { year: 2021, round: 1, orig: 'MIA', known: true, status: 'used', overall: 18, owner: 'OKC' },
  // Chris Paul trade (2017)
  { year: 2018, round: 1, orig: 'HOU', known: true, text: 'Top-3 protected', prot: [{ year: 2018, range: '1-3', then: 'Pick is kept by Houston' }], status: 'used', overall: 25, owner: 'LAC' },
  // Future picks (Harden trade, 2023)
  // Future picks: final_owner stays NULL; the holder is the to_franchise of the latest linked part.
  { year: 2028, round: 1, orig: 'LAC', known: null, text: null, status: 'future' },
  { year: 2028, round: 2, orig: 'PHI', known: true, status: 'future' },
  // Uncertain: Clippers-original 2028 second, with no linked outgoing part (the 2025 trade names it only as text)
  { year: 2028, round: 2, orig: 'LAC', known: null, text: null, status: 'future' },
  { year: 1996, round: 1, orig: 'LAC', known: true, status: 'used', overall: 7, selected: 'wrighlo01', owner: 'LAC' },
  // 1975 Seattle trade
  { year: 1976, round: 2, orig: 'OKC', known: true, status: 'used', overall: 24, owner: 'LAC' },
  // Pick chain: ORL -> HOU -> LAC
  { year: 2021, round: 2, orig: 'ORL', known: true, status: 'used', overall: 33, selected: 'prestja01', owner: 'LAC' },
  // Another club's trade (not a Clippers move)
  { year: 2025, round: 1, orig: 'DEN', known: true, text: 'Top-5 protected', prot: [{ year: 2025, range: '1-5', then: 'Converts to a 2026 second' }], status: 'used', overall: 28, owner: 'ORL' },
  // Draft history
  { year: 1971, round: 1, orig: 'LAC', known: true, status: 'used', overall: 3, selected: 'smithel01', owner: 'LAC' },
  { year: 1982, round: 1, orig: 'LAC', known: true, status: 'used', overall: 2, selected: 'cummite01', owner: 'LAC' },
  { year: 1988, round: 1, orig: 'LAC', known: true, status: 'used', overall: 1, selected: 'mannida01', owner: 'LAC' },
  { year: 2009, round: 1, orig: 'LAC', known: true, status: 'used', overall: 1, selected: 'griffbl01', owner: 'LAC' },
  { year: 2011, round: 1, orig: 'LAC', known: true, status: 'used', overall: 1, selected: 'irvinky01', owner: 'CLE' }, // traded away before the draft
  { year: 2018, round: 1, orig: 'LAC', known: true, status: 'used', overall: 13, selected: 'robinje01', owner: 'LAC' },
  { year: 2019, round: 2, orig: 'LAC', known: true, status: 'used', overall: 48, selected: 'mannte01', owner: 'LAC' },
  // Lottery rows for picks Clippers never touched
  { year: 2014, round: 1, orig: 'MIL', known: true, status: 'used', overall: 2, selected: 'parkeja01', owner: 'MIL' },
  { year: 1985, round: 1, orig: 'NYK', known: true, status: 'used', overall: 1, selected: 'ewingpa01', owner: 'NYK' },
  { year: 2015, round: 1, orig: 'LAL', known: true, status: 'used', overall: 2, selected: 'russeda01', owner: 'LAL' },
];

interface SwapDef {
  year: number; round: number; a: Tri; b: Tri;
  known?: boolean | null; text?: string | null; exercised: boolean | null;
}
const swapRef = (s: SwapDef) => `${s.year}-${s.round}-${s.a}-${s.b}`;
const swaps: SwapDef[] = [
  { year: 2023, round: 1, a: 'LAC', b: 'OKC', known: true, exercised: true },
  { year: 2025, round: 1, a: 'LAC', b: 'OKC', known: true, text: 'Top-10 protected', exercised: false },
  { year: 2029, round: 1, a: 'LAC', b: 'PHI', known: null, text: null, exercised: null }, // future swap
];

interface LotteryDef { year: number; pick: string; slot: number | null; odds: number | null; won: number; tie: boolean; source: 'wiki' | 'derived' }
const lottery: LotteryDef[] = [
  { year: 2011, pick: pickRef(2011, 1, 'LAC'), slot: 8, odds: 0.028, won: 1, tie: false, source: 'wiki' }, // held by CLE; jumped up
  { year: 2009, pick: pickRef(2009, 1, 'LAC'), slot: 3, odds: 0.177, won: 1, tie: false, source: 'wiki' }, // Clippers jumped up
  { year: 1988, pick: pickRef(1988, 1, 'LAC'), slot: 1, odds: null, won: 1, tie: false, source: 'wiki' }, // equal-odds era
  { year: 1996, pick: pickRef(1996, 1, 'LAC'), slot: 6, odds: null, won: 7, tie: false, source: 'wiki' }, // Clippers fell one spot; odds unrecorded
  { year: 2014, pick: pickRef(2014, 1, 'MIL'), slot: 1, odds: 0.25, won: 2, tie: false, source: 'wiki' }, // fell
  { year: 1985, pick: pickRef(1985, 1, 'NYK'), slot: 7, odds: null, won: 1, tie: false, source: 'wiki' }, // odds unknown
  { year: 2015, pick: pickRef(2015, 1, 'LAL'), slot: 4, odds: 0.119, won: 2, tie: true, source: 'derived' },
];

// ── Transactions ─────────────────────────────────────────────────────────────

type AssetKind = 'player' | 'draft_rights' | 'pick' | 'swap' | 'cash' | 'exception' | 'other';
type Gap = 'pick_unidentified' | 'protections_unknown' | 'source_conflict' | 'person_unmatched' | 'party_unknown';
interface PartDef {
  f?: Tri | null; t?: Tri | null; k: AssetKind;
  person?: string; pick?: string; swap?: string; text?: string; gap?: Gap;
}
interface TxDef {
  key: string; slug: string; date: string; clippers: boolean; kind: string; desc: string;
  complete?: boolean; parts: PartDef[];
}
const pl = (f: Tri | null, t: Tri | null, p: string, extra: Partial<PartDef> = {}): PartDef => ({ f, t, k: 'player', person: p, ...extra });
const pk = (f: Tri | null, t: Tri | null, ref: string, extra: Partial<PartDef> = {}): PartDef => ({ f, t, k: 'pick', pick: ref, ...extra });

const txs: TxDef[] = [
  // 2019-07-10 Paul George trade (LAC-OKC), multi-asset
  {
    key: 'nba:Trade 1158000', slug: '2019-07-10-paul-george', date: '2019-07-10', clippers: true, kind: 'trade',
    desc: 'The Clippers acquired Paul George from Oklahoma City for Shai Gilgeous-Alexander, Danilo Gallinari, four first-round picks and two pick swaps.',
    parts: [
      pl('OKC', LAC, 'georgpa01'),
      pl(LAC, 'OKC', 'gilgesh01'),
      pl(LAC, 'OKC', 'gallida01'),
      pk(LAC, 'OKC', pickRef(2022, 1, 'LAC')),
      pk(LAC, 'OKC', pickRef(2024, 1, 'LAC')),
      pk(LAC, 'OKC', pickRef(2026, 1, 'LAC')),
      pk(LAC, 'OKC', pickRef(2021, 1, 'MIA')),
      { f: LAC, t: 'OKC', k: 'swap', swap: swapRef(swaps[0]) },
      { f: LAC, t: 'OKC', k: 'swap', swap: swapRef(swaps[1]) },
    ],
  },
  // Gallinari tree: league rows following one asset after the George trade (4 steps, so depth 3 truncates)
  {
    key: 'nba:Trade 1181000', slug: '2020-11-22-gallinari-okc-atl', date: '2020-11-22', clippers: false, kind: 'trade',
    desc: 'Oklahoma City sent Danilo Gallinari to Atlanta in a sign-and-trade.',
    parts: [pl('OKC', 'ATL', 'gallida01')],
  },
  {
    key: 'nba:Trade 1229000', slug: '2022-02-08-gallinari-atl-sas', date: '2022-02-08', clippers: false, kind: 'trade',
    desc: 'Atlanta traded Danilo Gallinari to San Antonio.',
    parts: [pl('ATL', 'SAS', 'gallida01')],
  },
  {
    key: 'nba:Waiver 51120', slug: '2022-02-15-gallinari-waived-sas', date: '2022-02-15', clippers: false, kind: 'waiver',
    desc: 'San Antonio waived Danilo Gallinari.',
    parts: [pl('SAS', null, 'gallida01')],
  },
  {
    key: 'nba:Signing 51207', slug: '2022-03-02-gallinari-signs-bos', date: '2022-03-02', clippers: false, kind: 'signing',
    desc: 'Boston signed Danilo Gallinari.',
    parts: [pl(null, 'BOS', 'gallida01')],
  },
  // 2017-06-28 Chris Paul trade (LAC-HOU)
  {
    key: 'nba:Trade 1034000', slug: '2017-06-28-chris-paul', date: '2017-06-28', clippers: true, kind: 'trade',
    desc: 'Houston acquired Chris Paul. The Clippers received six players, a 2018 first-round pick and cash.',
    parts: [
      pl(LAC, 'HOU', 'paulch01'),
      pl('HOU', LAC, 'beverpa01'),
      pl('HOU', LAC, 'willilo02'),
      pl('HOU', LAC, 'harremo01'),
      pl('HOU', LAC, 'dekkesa01'),
      pl('HOU', LAC, 'liggide01'),
      pl('HOU', LAC, 'hilliar01'),
      pk('HOU', LAC, pickRef(2018, 1, 'HOU')),
      { f: 'HOU', t: LAC, k: 'cash', text: '$661,458 in cash' },
    ],
  },
  // Three-team trade, one part with no known sender
  {
    key: 'nba:Trade 1198000', slug: '2021-03-25-kennard-three-team', date: '2021-03-25', clippers: true, kind: 'trade',
    desc: 'A three-team deal between the Clippers, Detroit and Sacramento sent Luke Kennard to Los Angeles.',
    parts: [
      pl('DET', LAC, 'kennalu01'),
      pl(LAC, 'SAC', 'mcgruro01'),
      pl(null, 'DET', 'wrighde01', { gap: 'party_unknown' }),
    ],
  },
  // Incomplete move with an unlinked part
  {
    key: 'nba:Trade 1227000', slug: '2022-02-10-batum-denver-partial', date: '2022-02-10', clippers: true, kind: 'trade',
    desc: 'The Clippers sent Nicolas Batum to Denver. Part of what they received is not yet identified.',
    complete: false,
    parts: [
      pl(LAC, 'DEN', 'batumni01'),
      { f: 'DEN', t: LAC, k: 'pick', text: 'a future second-round pick', gap: 'pick_unidentified' },
    ],
  },
  // 1975 Seattle trade, Buffalo Braves era
  {
    key: 'bbref:Trade 1975-10-14', slug: '1975-10-14-braves-supersonics', date: '1975-10-14', clippers: true, kind: 'trade',
    desc: 'The Buffalo Braves traded Bob Kauffman to Seattle for Dean Tolson and a 1976 second-round pick.',
    parts: [
      pl(LAC, 'OKC', 'kaufmbo01'),
      pl('OKC', LAC, 'tolsode01'),
      pk('OKC', LAC, pickRef(1976, 2, 'OKC')),
    ],
  },
  // 2023-10-31 Harden trade: gives the Clippers a pick they owe with unknown protections, a pick they own, and a future swap
  {
    key: 'nba:Trade 1311000', slug: '2023-10-31-james-harden', date: '2023-10-31', clippers: true, kind: 'trade',
    desc: 'The Clippers acquired James Harden, P.J. Tucker and Filip Petrusev from Philadelphia for four players and a 2028 first-round pick. They also gained a 2028 second-round pick and a 2029 first-round swap.',
    parts: [
      pl('PHI', LAC, 'hardeja01'),
      pl('PHI', LAC, 'tuckepj01'),
      pl('PHI', LAC, 'petrufi01'),
      pl(LAC, 'PHI', 'morrima02'),
      pl(LAC, 'PHI', 'batumni01'),
      pl(LAC, 'PHI', 'covinro01'),
      pl(LAC, 'PHI', 'martike01'),
      pk(LAC, 'PHI', pickRef(2028, 1, 'LAC'), { gap: 'protections_unknown' }),
      pk('PHI', LAC, pickRef(2028, 2, 'PHI')),
      { f: 'PHI', t: LAC, k: 'swap', swap: swapRef(swaps[2]), gap: 'protections_unknown' },
    ],
  },
  // Pick chain, hop 1 (not a Clippers move): ORL -> HOU
  {
    key: 'nba:Trade 1183000', slug: '2020-11-18-orlando-houston-second', date: '2020-11-18', clippers: false, kind: 'trade',
    desc: 'Orlando sent its 2021 second-round pick to Houston.',
    parts: [pk('ORL', 'HOU', pickRef(2021, 2, 'ORL')), { f: 'ORL', t: 'HOU', k: 'cash', text: 'cash considerations' }],
  },
  // Pick chain, hop 2: HOU -> LAC
  {
    key: 'nba:Trade 1205000', slug: '2021-02-25-houston-second-round-pick', date: '2021-02-25', clippers: true, kind: 'trade',
    desc: 'The Clippers acquired a 2021 second-round pick from Houston, originally Orlando’s, for cash.',
    parts: [pk('HOU', LAC, pickRef(2021, 2, 'ORL')), { f: LAC, t: 'HOU', k: 'cash', text: 'cash considerations' }],
  },
  // A league trade that is not part of any Clippers tree
  {
    key: 'nba:Trade 1204000', slug: '2021-03-25-aaron-gordon', date: '2021-03-25', clippers: false, kind: 'trade',
    desc: 'Denver acquired Aaron Gordon from Orlando for Gary Harris, RJ Hampton and a 2025 first-round pick.',
    parts: [
      pl('ORL', 'DEN', 'gordoaa01'),
      pl('DEN', 'ORL', 'harriga01'),
      pl('DEN', 'ORL', 'hamptrj01'),
      pk('DEN', 'ORL', pickRef(2025, 1, 'DEN')),
    ],
  },
  // Sends a Clippers-original 2028 second-round pick that the source did not identify
  {
    key: 'nba:Trade 1327000', slug: '2025-02-06-hartwell-utah', date: '2025-02-06', clippers: true, kind: 'trade',
    desc: 'The Clippers acquired Alex Hartwell from Utah for a 2028 second-round pick.',
    parts: [
      pl('UTA', LAC, 'name:alex-hartwell-1999'),
      { f: LAC, t: 'UTA', k: 'pick', text: '2028 second-round pick', gap: 'pick_unidentified' },
    ],
  },
  // Signings and other moves, 2023-2025
  { key: 'nba:Signing 52011', slug: '2023-07-06-kobe-brown-two-way', date: '2023-07-06', clippers: true, kind: 'two_way', desc: 'The Clippers signed Kobe Brown to a two-way contract.', parts: [pl(null, LAC, 'brownko01')] },
  { key: 'nba:Signing 52244', slug: '2024-01-10-jordan-miller-ten-day', date: '2024-01-10', clippers: true, kind: 'ten_day', desc: 'The Clippers signed Jordan Miller to a 10-day contract.', parts: [pl(null, LAC, 'name:jordan-miller-1998')] },
  { key: 'nba:Signing 52301', slug: '2024-03-02-kobe-brown-conversion', date: '2024-03-02', clippers: true, kind: 'conversion', desc: 'The Clippers converted Kobe Brown’s two-way deal to a standard contract.', parts: [pl(null, LAC, 'brownko01')] },
  { key: 'nba:Signing 52399', slug: '2024-07-07-james-harden-re-signs', date: '2024-07-07', clippers: true, kind: 're_signing', desc: 'James Harden re-signed with the Clippers.', parts: [pl(null, LAC, 'hardeja01')] },
  { key: 'nba:Signing 52412', slug: '2024-09-19-kawhi-leonard-extension', date: '2024-09-19', clippers: true, kind: 'extension', desc: 'The Clippers extended Kawhi Leonard’s contract.', parts: [pl(null, LAC, 'leonaka01')] },
  { key: 'nba:Waiver 52477', slug: '2024-10-19-joshua-primo-waived', date: '2024-10-19', clippers: true, kind: 'waiver', desc: 'The Clippers waived Joshua Primo.', parts: [pl(LAC, null, 'primojo01')] },
  { key: 'nba:Claim 52531', slug: '2025-01-14-kai-jones-claimed', date: '2025-01-14', clippers: true, kind: 'claim', desc: 'The Clippers claimed Kai Jones off waivers.', parts: [pl(null, LAC, 'name:kai-jones-2001')] },
  { key: 'nba:Release 52590', slug: '2025-04-05-alex-hartwell-released', date: '2025-04-05', clippers: true, kind: 'release', desc: 'The Clippers released Alex Hartwell.', parts: [pl(LAC, null, 'name:alex-hartwell-1999')] },
  { key: 'nba:Signing 52641', slug: '2025-07-06-bradley-beal-signs', date: '2025-07-06', clippers: true, kind: 'signing', desc: 'Bradley Beal signed with the Clippers.', parts: [pl(null, LAC, 'bealbr01')] },
  { key: 'nba:Signing 52644', slug: '2025-07-09-brook-lopez-signs', date: '2025-07-09', clippers: true, kind: 'signing', desc: 'Brook Lopez signed with the Clippers.', parts: [pl(null, LAC, 'lopezbr01')] },
  { key: 'nba:Signing 52702', slug: '2025-10-18-kobe-sanders-two-way', date: '2025-10-18', clippers: true, kind: 'two_way', desc: 'The Clippers signed Kobe Sanders to a two-way contract.', parts: [pl(null, LAC, 'name:kobe-sanders-2002')] },
];

// ── Salaries, contracts, coaches, executives, honors ─────────────────────────

const salaries: Array<[number, string, number | null]> = [
  // 1984 era (partial coverage; Walton's salary is untracked)
  [1984, 'nixonno01', 1_170_000], [1984, 'johnsma01', 1_000_000], [1984, 'smithde01', 350_000], [1984, 'waltobi01', null],
  // 2019-2025
  [2019, 'leonaka01', 32_742_000], [2019, 'georgpa01', 30_560_000], [2019, 'zubaciv01', 7_000_000], [2019, 'mannte01', null],
  [2020, 'leonaka01', 34_379_100], [2020, 'georgpa01', 33_005_556], [2020, 'zubaciv01', 7_000_000], [2020, 'mannte01', 1_517_981],
  [2021, 'leonaka01', 36_016_200], [2021, 'georgpa01', 35_450_000], [2021, 'zubaciv01', 7_500_000], [2021, 'mannte01', 1_782_621],
  [2022, 'leonaka01', 39_344_900], [2022, 'georgpa01', 39_344_900], [2022, 'zubaciv01', 7_500_000], [2022, 'mannte01', 1_900_000],
  [2023, 'leonaka01', 45_640_084], [2023, 'georgpa01', 45_640_084], [2023, 'zubaciv01', 10_000_000], [2023, 'mannte01', 11_000_000],
  [2024, 'leonaka01', 49_350_000], [2024, 'hardeja01', 35_680_000], [2024, 'zubaciv01', 11_700_000], [2024, 'mannte01', 11_500_000],
  [2025, 'leonaka01', 50_000_000], [2025, 'hardeja01', 36_000_000], [2025, 'zubaciv01', 12_000_000], [2025, 'mannte01', 11_500_000], [2025, 'bealbr01', 14_100_000],
];
const payroll: Array<[number, number | null, number | null, number | null, boolean | null]> = [
  [1984, 3, 14, 2_520_000, true], // listed total covers only the three tracked salaries
  [2019, 3, 17, 70_302_000, false], [2020, 4, 17, 76_360_981, false], [2021, 4, 16, 80_748_821, false],
  [2022, 4, 17, 88_089_800, false], [2023, 4, 17, 112_624_168, false], [2024, 4, 17, 107_210_000, false],
  [2025, 5, 17, 123_600_000, false],
];

type Opt = 'player' | 'team' | 'early_termination' | null;
type ContractRow = [string, number, number | null, number | null, Opt]; // person, season, amount, guaranteed, option
const OLDER_SNAPSHOT = { id: 'cap-2026-10-26', at: '2026-10-26T06:00:00Z' };
const NEWER_SNAPSHOT = { id: 'cap-2026-11-09', at: '2026-11-09T06:00:00Z' };
const contractsOlder: ContractRow[] = [
  ['leonaka01', 2026, 50_000_000, 50_000_000, null], ['leonaka01', 2027, 52_500_000, 52_500_000, 'player'],
  ['hardeja01', 2026, 36_000_000, 36_000_000, null], ['hardeja01', 2027, 37_800_000, 37_800_000, 'early_termination'],
  ['zubaciv01', 2026, 12_000_000, 12_000_000, null], ['zubaciv01', 2027, 12_600_000, 12_600_000, null], ['zubaciv01', 2028, 13_200_000, 13_200_000, null],
  ['mannte01', 2026, 11_000_000, 11_000_000, null], ['mannte01', 2027, 11_500_000, 11_500_000, 'team'],
  ['bealbr01', 2026, 14_100_000, 14_100_000, null], ['bealbr01', 2027, 13_800_000, 13_800_000, 'player'],
  ['lopezbr01', 2026, 3_000_000, 3_000_000, null],
];
const contractsNewer: ContractRow[] = [
  ['leonaka01', 2026, 50_000_000, 50_000_000, null], ['leonaka01', 2027, 52_500_000, 52_500_000, null],
  ['leonaka01', 2028, 55_000_000, 55_000_000, 'player'], ['leonaka01', 2029, 57_500_000, null, 'player'],
  ['hardeja01', 2026, 36_000_000, 36_000_000, null], ['hardeja01', 2027, 37_800_000, 37_800_000, 'early_termination'],
  ['zubaciv01', 2026, 12_000_000, 12_000_000, null], ['zubaciv01', 2027, 12_600_000, 12_600_000, null], ['zubaciv01', 2028, 13_200_000, 4_000_000, null],
  ['mannte01', 2026, 11_000_000, 11_000_000, null], ['mannte01', 2027, 11_500_000, 11_500_000, null], ['mannte01', 2028, 12_000_000, 4_000_000, 'team'],
  ['bealbr01', 2026, 14_100_000, 14_100_000, null], ['bealbr01', 2027, 13_800_000, 13_800_000, 'player'],
  ['lopezbr01', 2026, 3_000_000, 3_000_000, null], ['lopezbr01', 2027, 3_200_000, null, 'team'],
  ['name:kobe-sanders-2002', 2026, 2_100_000, 600_000, null], ['name:kobe-sanders-2002', 2027, 2_300_000, null, 'team'],
];

// season, person, ordinal, games, wins, losses, playoff wins, playoff losses
type CoachRow = [number, string, number, number | null, number | null, number | null, number | null, number | null];
const coachSeasons: CoachRow[] = [
  [1970, 'schaydo01', 1, 82, 22, 60, null, null],
  [1971, 'schaydo01', 1, 82, 22, 60, null, null],
  [1972, 'ramsaja99', 1, 82, 21, 61, null, null],
  [1973, 'ramsaja99', 1, 82, 42, 40, 3, 4],
  [1974, 'ramsaja99', 1, 82, 49, 33, 3, 4],
  [2002, 'gentral01', 1, 41, 14, 27, null, null], // mid-season change
  [2002, 'dunlemi01', 2, 41, 17, 24, null, null],
  [2013, 'riverdo01', 1, 82, 56, 26, 6, 6],
  [2014, 'riverdo01', 1, 82, 57, 25, 6, 6],
  [2015, 'riverdo01', 1, 82, 53, 29, 3, 4],
  [2016, 'riverdo01', 1, 82, 53, 29, 2, 4],
  [2017, 'riverdo01', 1, 82, 42, 40, null, null],
  [2018, 'riverdo01', 1, 82, 48, 34, 2, 4],
  [2019, 'riverdo01', 1, 72, 49, 23, 7, 6],
  [2020, 'luety01', 1, 72, 47, 25, 9, 10],
  [2021, 'luety01', 1, 82, 42, 40, null, null],
  [2022, 'luety01', 1, 82, 44, 38, null, null],
  [2023, 'luety01', 1, 82, 51, 31, 2, 3],
  [2024, 'luety01', 1, 82, 50, 32, 2, 4],
];

const execTerms: Array<[string, string | null, string | null, string | null]> = [
  ['name:lawrence-frank-1970', 'President of Basketball Operations', '2017-06-12', null], // open-ended
  ['name:michael-winger-1982', 'General Manager', '2019-09-01', '2024-06-30'],
  ['baylore01', 'Vice President of Basketball Operations', '1986-07-01', '2008-10-01'],
];

// Only honors earned with the franchise (plus the league-wide Russell number).
const honors: Array<[number | null, string, string, string | null]> = [
  [1974, 'mcadobo01', 'mvp', 'Buffalo Braves'],
  [2010, 'griffbl01', 'roy', null], [2010, 'griffbl01', 'all_rookie_1', null],
  [2010, 'griffbl01', 'all_star', null], [2011, 'griffbl01', 'all_star', null], [2012, 'griffbl01', 'all_star', null],
  [2013, 'griffbl01', 'all_star', null], [2014, 'griffbl01', 'all_star', null],
  [2012, 'paulch01', 'all_star', null], [2013, 'paulch01', 'all_star', null], [2014, 'paulch01', 'all_star', null],
  [2012, 'paulch01', 'all_nba_1', null], [2013, 'paulch01', 'all_nba_1', null], [2014, 'paulch01', 'all_nba_1', null],
  [2019, 'leonaka01', 'all_star', null], [2020, 'leonaka01', 'all_star', null],
  [2019, 'leonaka01', 'all_nba_2', null], [2020, 'leonaka01', 'all_nba_2', null],
  [2020, 'georgpa01', 'all_star', null], [2023, 'georgpa01', 'all_star', null], [2020, 'georgpa01', 'all_nba_3', null],
  [2017, 'willilo02', 'smoy', null], [2018, 'willilo02', 'smoy', null], [2019, 'harremo01', 'smoy', null],
  [null, 'mcadobo01', 'hall_of_fame', '2000'], [null, 'wilkido01', 'hall_of_fame', '2006'],
  [null, 'waltobi01', 'hall_of_fame', '1993'], [null, 'name:larry-brown-1940', 'hall_of_fame', '2002'],
  [null, 'russebi01', 'retired_number_league', 'No. 6'],
  // No retired_number rows: the Clippers have retired none.
];

// ── Games ────────────────────────────────────────────────────────────────────

const OPPONENTS: Tri[] = ['DEN', 'GSW', 'LAL', 'PHX', 'DAL', 'OKC', 'HOU', 'MIN'];
interface GameDef {
  season: number; date: string; nbaId: number; opp: Tri; home: boolean; lac: number; oppScore: number; playoffs: boolean;
}
function makeGames(season: number, start: string, n: number, idBase: number): GameDef[] {
  const out: GameDef[] = [];
  for (let i = 0; i < n; i++) {
    const lac = 98 + ((i * 7 + season) % 19);
    let opp = 96 + ((i * 5 + season) % 21);
    if (opp === lac) opp += 1;
    out.push({ season, date: addDays(start, i * 3), nbaId: idBase + i, opp: OPPONENTS[(i + season) % OPPONENTS.length], home: i % 2 === 0, lac, oppScore: opp, playoffs: false });
  }
  return out;
}
const games: GameDef[] = [
  ...makeGames(2017, '2017-10-19', 5, 21700001),
  ...makeGames(2019, '2019-10-22', 5, 21900001),
  { season: 2019, date: '2020-08-18', nbaId: 41900101, opp: 'DAL', home: true, lac: 118, oppScore: 110, playoffs: true },
  ...makeGames(2025, '2025-10-22', 6, 22500001),
];
const ROSTER: Record<number, string[]> = {
  2019: ['leonaka01', 'georgpa01', 'zubaciv01', 'mannte01'],
  2025: ['leonaka01', 'hardeja01', 'zubaciv01', 'mannte01'],
};
const JERSEY: Record<string, string> = { leonaka01: '2', georgpa01: '13', zubaciv01: '40', mannte01: '14', hardeja01: '1' };

// ── Main ─────────────────────────────────────────────────────────────────────

const REPO = process.cwd(); // run from the repo root (npm scripts do)

async function main() {
  // 1. Schema (idempotent) and the gap_reason widening
  const schema = fs.readFileSync(path.join(REPO, 'Docs/DB_SCHEMA.sql'), 'utf8');
  await sql.unsafe(schema);
  // Mirrors the pending PR-1 migration fix: party_unknown is a valid gap code.
  await sql.unsafe(`
    ALTER TABLE transaction_parts DROP CONSTRAINT IF EXISTS transaction_parts_gap_reason_check;
    ALTER TABLE transaction_parts ADD CONSTRAINT transaction_parts_gap_reason_check
      CHECK (gap_reason IN ('pick_unidentified','protections_unknown','source_conflict','person_unmatched','party_unknown'));
  `);

  await sql.begin(async (tx) => {
    const ins = async (table: string, rows: Record<string, unknown>[]) => {
      if (rows.length === 0) return;
      await tx`INSERT INTO ${tx(table)} ${tx(rows as never, ...(Object.keys(rows[0]) as never[]))}`;
    };

    await tx.unsafe(`
      TRUNCATE seasons, teams, players, person_xref, draft_picks, pick_swaps, transactions, transaction_parts,
               draft_lottery, salaries, payroll_seasons, contracts, coach_seasons, executive_terms, honors,
               team_seasons, team_era_names
      RESTART IDENTITY CASCADE`);

    // 3. Reference tables
    await tx`
      INSERT INTO seasons (season_id, label)
      SELECT y, y || '-' || lpad(((y + 1) % 100)::text, 2, '0') FROM generate_series(1946, 2026) AS y`;

    const teamIds = new Map<string, number>();
    for (const [i, [tri, city, name, conf]] of TEAMS.entries()) {
      const [row] = await tx<{ team_id: string }[]>`
        INSERT INTO teams (nba_team_id, abbreviation, name, city, conference)
        VALUES (${i + 1}, ${tri}, ${name}, ${city}, ${conf}) RETURNING team_id::text`;
      teamIds.set(tri, Number(row.team_id));
    }
    const lacTeamId = teamIds.get('LAC')!;

    await ins('team_era_names', ERA_NAMES.map(([tri, first, last]) => {
      const e = eraFor(tri, first);
      return { team_id: teamIds.get(tri)!, first_season_id: first, last_season_id: last, abbreviation: e.abbr, city: e.city, name: e.name };
    }));

    // Every (season, franchise) the franchise rows reference, plus the Clippers every season and
    // every team 2015-2025.
    const needed = new Map<string, [number, Tri]>();
    const need = (season: number, tri: Tri) => needed.set(`${season}|${tri}`, [season, tri]);
    for (let s = 1970; s <= 2025; s++) need(s, LAC);
    for (let s = 2015; s <= 2025; s++) for (const t of TEAMS) need(s, t[0]);
    for (const t of txs) {
      const s = seasonOf(t.date);
      for (const p of t.parts) for (const f of [p.f, p.t]) if (f) need(s, f);
    }
    for (const p of picks) for (const y of [p.year - 1, p.year]) { need(y, p.orig); if (p.owner) need(y, p.owner); }
    for (const s of swaps) for (const y of [s.year - 1, s.year]) { need(Math.min(y, 2025), s.a); need(Math.min(y, 2025), s.b); }
    for (const l of lottery) { const p = picks.find((x) => pickRef(x.year, x.round, x.orig) === l.pick)!; need(l.year - 1, p.orig); }
    await ins('team_seasons', [...needed.values()].sort((a, b) => a[0] - b[0]).map(([season, tri]) => {
      const e = eraFor(tri, season);
      const rec = tri === 'LAC' && LAC_RECORDS[season] ? LAC_RECORDS[season] : (() => { const w = 18 + (hash(`${season}${tri}`) % 46); return [w, 82 - w]; })();
      return {
        season_id: season, nba_franchise_id: fid(tri), team_id: teamIds.get(tri)!,
        city: e.city, name: e.name, abbreviation: e.abbr,
        wins: season <= 2025 ? rec[0] : null, losses: season <= 2025 ? rec[1] : null,
      };
    }));

    // 4. Players, games, box scores
    const pageKeys = people.filter((p) => p.page);
    const playerIds = new Map<string, number>();
    for (const p of pageKeys) {
      const pg = p.page!;
      const [row] = await tx<{ player_id: string }[]>`
        INSERT INTO players (nba_person_id, first_name, last_name, display_name, position, height_in, weight_lb, birthdate, is_active)
        VALUES (${p.nbaId ?? null}, ${pg.first}, ${pg.last}, ${p.name}, ${pg.pos}, ${pg.heightIn}, ${pg.weightLb}, ${p.birth ?? null}, ${p.key !== 'georgpa01'})
        RETURNING player_id::text`;
      playerIds.set(p.key, Number(row.player_id));
    }

    const gameIds = new Map<number, number>();
    for (const g of games) {
      const oppId = teamIds.get(g.opp)!;
      const home = g.home ? lacTeamId : oppId;
      const away = g.home ? oppId : lacTeamId;
      const homeScore = g.home ? g.lac : g.oppScore;
      const awayScore = g.home ? g.oppScore : g.lac;
      const [row] = await tx<{ game_id: string }[]>`
        INSERT INTO all_games (nba_game_id, season_id, game_date, status, home_team_id, away_team_id, home_score, away_score, is_playoffs)
        VALUES (${g.nbaId}, ${g.season}, ${g.date}, 'final', ${home}, ${away}, ${homeScore}, ${awayScore}, ${g.playoffs})
        RETURNING game_id::text`;
      gameIds.set(g.nbaId, Number(row.game_id));
    }

    const teamBox: Record<string, unknown>[] = [];
    const playerBox: Record<string, unknown>[] = [];
    const rolling: Record<string, unknown>[] = [];
    const running = new Map<string, number[]>();
    games.forEach((g, gi) => {
      const gameId = gameIds.get(g.nbaId)!;
      const oppId = teamIds.get(g.opp)!;
      for (const [teamId, pts, isHome] of [[lacTeamId, g.lac, g.home], [oppId, g.oppScore, !g.home]] as const) {
        teamBox.push({
          game_id: gameId, team_id: teamId, is_home: isHome, minutes: 240, points: pts,
          rebounds: 38 + (gi % 9), assists: 21 + (gi % 7), steals: 6 + (gi % 4), blocks: 4 + (gi % 3), turnovers: 11 + (gi % 5), fouls: 17 + (gi % 6),
          fg_made: Math.round(pts * 0.39), fg_attempted: Math.round(pts * 0.85), fg3_made: 11 + (gi % 6), fg3_attempted: 33 + (gi % 8),
          ft_made: 16 + (gi % 5), ft_attempted: 21 + (gi % 5), offensive_reb: 9 + (gi % 4), defensive_reb: 29 + (gi % 5),
        });
      }
      (ROSTER[g.season] ?? []).forEach((key, k) => {
        const pts = 11 + ((gi * 3 + k * 5) % 17);
        const mins = 26 + ((gi + k) % 10);
        playerBox.push({
          game_id: gameId, team_id: lacTeamId, player_id: playerIds.get(key)!, starter: k < 3,
          minutes: `PT${mins}M${10 + ((gi * 7 + k) % 50)}.00S`, points: pts, rebounds: 3 + ((gi + k * 2) % 8), assists: 2 + ((gi * 2 + k) % 7),
          steals: (gi + k) % 3, blocks: (gi * k) % 3, turnovers: 1 + ((gi + k) % 4), fouls: (gi + k) % 5, plus_minus: ((gi * 5 + k * 3) % 21) - 8,
          fg_made: Math.round(pts * 0.4), fg_attempted: Math.round(pts * 0.82), fg3_made: (gi + k) % 4, fg3_attempted: 2 + ((gi + k) % 5),
          ft_made: 2 + ((gi + k) % 5), ft_attempted: 3 + ((gi + k) % 5), offensive_reb: (gi + k) % 3, defensive_reb: 2 + ((gi + k) % 5),
        });
        if (g.season === 2025 && key !== 'mannte01') {
          const hist = running.get(key) ?? [];
          hist.push(pts);
          running.set(key, hist);
          for (const w of [5, 10]) {
            const slice = hist.slice(-w);
            const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
            rolling.push({
              player_id: playerIds.get(key)!, team_id: lacTeamId, season_id: 2025, window_games: w, as_of_game_date: g.date,
              points: avg, rebounds: 4.5 + k * 0.4, assists: 3.5 + k * 0.3, ts_pct: 0.56 + k * 0.01, efg_pct: 0.52 + k * 0.01, minutes: 28 + k,
            });
          }
        }
      });
    });
    await ins('game_team_box_scores', teamBox);
    await ins('game_player_box_scores', playerBox);
    await ins('rolling_player_stats', rolling);

    const stints: Record<string, unknown>[] = [];
    for (const [season, keys] of Object.entries(ROSTER)) {
      for (const key of keys) {
        stints.push({ player_id: playerIds.get(key)!, team_id: lacTeamId, season_id: Number(season), start_date: `${season}-07-01`, jersey_number: JERSEY[key] });
      }
    }
    await ins('player_team_stints', stints);

    // 5. Franchise tables
    if (!EMPTY) {
    await ins('person_xref', people.map((p) => ({
      person_key: p.key, kind: p.kind, display_name: p.name, birthdate: p.birth ?? null, nba_person_id: p.nbaId ?? null,
      player_id: playerIds.get(p.key) ?? null,
    })));

    const pickIds = new Map<string, number>();
    for (const p of picks) {
      const ref = pickRef(p.year, p.round, p.orig);
      const [row] = await tx<{ pick_id: number }[]>`
        INSERT INTO draft_picks (pick_key, draft_year, round, original_franchise_id, protections, protections_text, protections_known,
                                 status, overall_pick, selected_person, final_owner_franchise_id)
        VALUES (${`${p.year}-${p.round}-${fid(p.orig)}`}, ${p.year}, ${p.round}, ${fid(p.orig)},
                ${p.prot ? tx.json(p.prot as never) : null}, ${p.text ?? null}, ${p.known ?? null},
                ${p.status}, ${p.overall ?? null}, ${p.selected ?? null}, ${p.owner ? fid(p.owner) : null})
        RETURNING pick_id`;
      pickIds.set(ref, row.pick_id);
    }
    const swapIds = new Map<string, number>();
    for (const s of swaps) {
      const [row] = await tx<{ swap_id: number }[]>`
        INSERT INTO pick_swaps (swap_key, draft_year, round, franchise_a, franchise_b, protections_text, protections_known, exercised)
        VALUES (${`${s.year}-${s.round}-${fid(s.a)}-${fid(s.b)}`}, ${s.year}, ${s.round}, ${fid(s.a)}, ${fid(s.b)},
                ${s.text ?? null}, ${s.known ?? null}, ${s.exercised})
        RETURNING swap_id`;
      swapIds.set(swapRef(s), row.swap_id);
    }
    await ins('draft_lottery', lottery.map((l) => ({
      draft_year: l.year, pick_id: pickIds.get(l.pick)!, pre_lottery_slot: l.slot, odds_first: l.odds, pick_won: l.won,
      tie_unresolved: l.tie, source: l.source,
    })));

    for (const t of txs) {
      const [row] = await tx<{ transaction_id: string }[]>`
        INSERT INTO transactions (transaction_key, slug, date, season_id, involves_clippers, kind, description, sources, is_complete)
        VALUES (${t.key}, ${slugify(t.slug)}, ${t.date}, ${seasonOf(t.date)}, ${t.clippers}, ${t.kind}, ${t.desc},
                ${tx.array([t.key])}, ${t.complete ?? true})
        RETURNING transaction_id::text`;
      await ins('transaction_parts', t.parts.map((p) => ({
        transaction_id: Number(row.transaction_id),
        from_franchise_id: p.f ? fid(p.f) : null,
        to_franchise_id: p.t ? fid(p.t) : null,
        asset_kind: p.k,
        person_key: p.person ?? null,
        pick_id: p.pick ? pickIds.get(p.pick) ?? (() => { throw new Error(`unknown pick ${p.pick}`); })() : null,
        swap_id: p.swap ? swapIds.get(p.swap) ?? (() => { throw new Error(`unknown swap ${p.swap}`); })() : null,
        unlinked_text: p.text ?? null,
        gap_reason: p.gap ?? null,
      })));
    }

    await ins('salaries', salaries.map(([season, key, amt]) => ({ season_id: season, person_key: key, amount_usd: amt, source: 'fixture' })));
    await ins('payroll_seasons', payroll.map(([s, listed, roster, total, partial]) => ({
      season_id: s, listed_players: listed, roster_players: roster, listed_total_usd: total, is_partial: partial,
    })));
    for (const [snap, rows] of [[OLDER_SNAPSHOT, contractsOlder], [NEWER_SNAPSHOT, contractsNewer]] as const) {
      await ins('contracts', rows.map(([key, season, amt, guar, opt]) => ({
        snapshot_id: snap.id, person_key: key, season_id: season, amount_usd: amt, guaranteed_usd: guar, option: opt, fetched_at: snap.at,
      })));
    }
    await ins('coach_seasons', coachSeasons.map(([s, key, ord, g, w, l, pw, pl2]) => ({
      season_id: s, person_key: key, ordinal: ord, games: g, wins: w, losses: l, playoff_wins: pw, playoff_losses: pl2,
    })));
    await ins('executive_terms', execTerms.map(([key, title, start, end]) => ({ person_key: key, title, start_date: start, end_date: end })));
    await ins('honors', honors.map(([s, key, honor, detail]) => ({ season_id: s, person_key: key, honor, detail })));
    }
  });

  // 6. Summary
  const tables = [
    'seasons', 'teams', 'team_seasons', 'team_era_names', 'players', 'player_team_stints', 'all_games',
    'game_team_box_scores', 'game_player_box_scores', 'rolling_player_stats', 'person_xref', 'draft_picks',
    'pick_swaps', 'transactions', 'transaction_parts', 'draft_lottery', 'salaries', 'payroll_seasons',
    'contracts', 'coach_seasons', 'executive_terms', 'honors',
  ];
  console.log(EMPTY ? 'Fixture seeded with EMPTY franchise tables. Row counts:' : 'Franchise fixture seeded. Row counts:');
  for (const t of tables) {
    const [{ n }] = await sql.unsafe<{ n: string }[]>(`SELECT count(*)::text AS n FROM ${t}`);
    console.log(`  ${t.padEnd(24)} ${n}`);
  }
  const pages = await sql<{ player_id: string; display_name: string }[]>`
    SELECT player_id::text, display_name FROM players ORDER BY player_id`;
  console.log('Player pages: ' + pages.map((p) => `/players/${p.player_id} (${p.display_name})`).join(', '));
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err);
    await sql.end({ timeout: 1 });
    process.exit(1);
  });
