// scripts/dev/seed-fixture-league.ts
// Builds a deterministic synthetic NBA league in a LOCAL Postgres database for
// testing the stats + insight pipeline end to end (see
// scripts/lib/insights/engine.integration.test.ts).
//
// DESTRUCTIVE: drops and recreates the public schema. Refuses to run unless
// FIXTURE_DATABASE_URL points at localhost / 127.0.0.1 / a unix socket.
//
// League: 30 teams (15 West, 15 East), 12 players each. Seasons 2024-25 and
// 2025-26: 60 game days × 15 games each (60 games per team); 2025-26 adds one
// Clippers play-in game. In 2024-25 the Clippers are average and Star Clipper
// less productive, so 2025-26 shows year-over-year improvement.
// 2026-27: the seasons row and three upcoming Clippers games (first vs GSW).
// Scripted Clippers facts the tests look for:
//   - the team is strong (top of the West, top-5 offense)
//   - "Star Clipper" closes the season with 30+ in 5 straight and has a
//     55-point game (top-1% scoring night)
//   - "Big Clipper" closes the season with 10+ rebounds in 6 straight
//   - "LAC Player 3" is traded to Boston for the last TRADE_DAYS game days,
//     so he must not appear in Clippers season insights
// Minutes are stored in the NBA ISO format ("PT34M12.00S").
//
// Run via: FIXTURE_DATABASE_URL=postgres://… npx tsx scripts/dev/seed-fixture-league.ts
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const url = process.env.FIXTURE_DATABASE_URL;
if (!url) throw new Error('FIXTURE_DATABASE_URL is not set');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1', ''].includes(host) && !host.startsWith('%2F') && !host.startsWith('/')) {
  throw new Error(`Refusing to wipe non-local database host "${host}"`);
}

// ── Deterministic randomness ─────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260923);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const irand = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));

// ── League definition ────────────────────────────────────────────────────────

const TEAMS: [string, string, string, 'West' | 'East'][] = [
  ['LAC', 'LA', 'Clippers', 'West'], ['GSW', 'Golden State', 'Warriors', 'West'],
  ['LAL', 'Los Angeles', 'Lakers', 'West'], ['DEN', 'Denver', 'Nuggets', 'West'],
  ['PHX', 'Phoenix', 'Suns', 'West'], ['DAL', 'Dallas', 'Mavericks', 'West'],
  ['MIN', 'Minnesota', 'Timberwolves', 'West'], ['OKC', 'Oklahoma City', 'Thunder', 'West'],
  ['SAC', 'Sacramento', 'Kings', 'West'], ['HOU', 'Houston', 'Rockets', 'West'],
  ['MEM', 'Memphis', 'Grizzlies', 'West'], ['NOP', 'New Orleans', 'Pelicans', 'West'],
  ['SAS', 'San Antonio', 'Spurs', 'West'], ['UTA', 'Utah', 'Jazz', 'West'],
  ['POR', 'Portland', 'Trail Blazers', 'West'],
  ['BOS', 'Boston', 'Celtics', 'East'], ['NYK', 'New York', 'Knicks', 'East'],
  ['MIL', 'Milwaukee', 'Bucks', 'East'], ['PHI', 'Philadelphia', '76ers', 'East'],
  ['CLE', 'Cleveland', 'Cavaliers', 'East'], ['MIA', 'Miami', 'Heat', 'East'],
  ['IND', 'Indiana', 'Pacers', 'East'], ['ORL', 'Orlando', 'Magic', 'East'],
  ['ATL', 'Atlanta', 'Hawks', 'East'], ['CHI', 'Chicago', 'Bulls', 'East'],
  ['BKN', 'Brooklyn', 'Nets', 'East'], ['TOR', 'Toronto', 'Raptors', 'East'],
  ['CHA', 'Charlotte', 'Hornets', 'East'], ['WAS', 'Washington', 'Wizards', 'East'],
  ['DET', 'Detroit', 'Pistons', 'East'],
];
const PLAYERS_PER_TEAM = 12;
const GAME_DAYS = 60;
const SEASONS = [
  { id: 2024, start: Date.UTC(2024, 9, 22), lacBoost: 0.95, starScale: 0.75 },
  { id: 2025, start: Date.UTC(2025, 9, 21), lacBoost: 1.25, starScale: 1 },
] as const;
const TRADED_PLAYER_ID = 3;   // "LAC Player 3"
const TRADE_TO = 15;          // BOS (team index)
const TRADE_DAYS = 10;

interface Player { id: number; teamIdx: number; name: string; talent: number; big: boolean }

function isoMinutes(min: number): string {
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  return `PT${String(m).padStart(2, '0')}M${String(s).padStart(2, '0')}.00S`;
}

interface Line {
  player_id: number; team_id: number; starter: boolean; minutes: string;
  points: number; rebounds: number; assists: number; steals: number; blocks: number;
  turnovers: number; fouls: number; plus_minus: number;
  fg_made: number; fg_attempted: number; fg3_made: number; fg3_attempted: number;
  ft_made: number; ft_attempted: number; offensive_reb: number; defensive_reb: number;
}

function playerLine(p: Player, teamBoost: number, starter: boolean): Line {
  const t = Math.min(1, p.talent * teamBoost);
  const minutes = starter ? between(26, 38) : between(8, 22);
  const fga = Math.max(1, Math.round((minutes / 36) * (6 + 14 * t) + between(-3, 3)));
  const fg3a = Math.round(fga * between(0.2, 0.45));
  const fg3m = Math.round(fg3a * between(0.25, 0.45));
  const fg2a = fga - fg3a;
  const fg2m = Math.round(fg2a * between(0.42, 0.6 + 0.05 * t));
  const fta = Math.round(fga * between(0.1, 0.35));
  const ftm = Math.round(fta * between(0.65, 0.9));
  const reb = Math.max(0, Math.round((minutes / 36) * (p.big ? 9 : 4) * between(0.6, 1.4)));
  const oreb = Math.round(reb * between(0.1, 0.3));
  return {
    player_id: p.id, team_id: p.teamIdx + 1, starter, minutes: isoMinutes(minutes),
    points: 2 * fg2m + 3 * fg3m + ftm,
    rebounds: reb, offensive_reb: oreb, defensive_reb: reb - oreb,
    assists: Math.max(0, Math.round((minutes / 36) * (p.big ? 2 : 5) * t * between(0.5, 1.5))),
    steals: irand(0, 2), blocks: p.big ? irand(0, 3) : irand(0, 1),
    turnovers: irand(0, 4), fouls: irand(0, 5), plus_minus: 0,
    fg_made: fg2m + fg3m, fg_attempted: fga, fg3_made: fg3m, fg3_attempted: fg3a,
    ft_made: ftm, ft_attempted: fta,
  };
}

async function main(): Promise<void> {
  const sql = postgres(url!, { max: 1, onnotice: () => {} }); // max 1: DB_SCHEMA.sql has BEGIN/COMMIT

  await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  const schema = fs.readFileSync(path.join(process.cwd(), 'Docs/DB_SCHEMA.sql'), 'utf8');
  await sql.unsafe(schema);

  await sql`INSERT INTO seasons (season_id, label) VALUES (2024, '2024-25'), (2025, '2025-26'), (2026, '2026-27')`;
  await sql`
    INSERT INTO teams ${sql(TEAMS.map(([abbr, city, name, conf], i) => ({
      team_id: i + 1, nba_team_id: i + 1, abbreviation: abbr, name, city, conference: conf,
    })))}
  `;

  const players: Player[] = [];
  TEAMS.forEach(([abbr], teamIdx) => {
    for (let k = 0; k < PLAYERS_PER_TEAM; k++) {
      const id = teamIdx * PLAYERS_PER_TEAM + k + 1;
      const name =
        abbr === 'LAC' && k === 0 ? 'Star Clipper'
        : abbr === 'LAC' && k === 1 ? 'Big Clipper'
        : `${abbr} Player ${k + 1}`;
      players.push({ id, teamIdx, name, talent: Math.max(0.15, 1 - k * 0.08 + between(-0.05, 0.05)), big: k % 4 === 1 });
    }
  });
  await sql`
    INSERT INTO players ${sql(players.map((p) => {
      const [first, ...rest] = p.name.split(' ');
      return {
        player_id: p.id, nba_player_id: p.id, nba_person_id: 1_000_000 + p.id,
        first_name: first, last_name: rest.join(' '), display_name: p.name,
      };
    }))}
  `;

  // Team strength per season: the rest of the league spreads out; LAC varies.
  let season: (typeof SEASONS)[number] = SEASONS[0];
  const boostOf = (teamIdx: number) =>
    teamIdx === 0 ? season.lacBoost : 0.8 + ((teamIdx * 7) % 30) / 60;

  const games: Record<string, unknown>[] = [];
  const teamBoxes: Record<string, unknown>[] = [];
  const playerBoxes: Record<string, unknown>[] = [];
  let gameId = 0;
  let lacGamesPlayed = 0;
  const LAC_GAMES = GAME_DAYS;

  const teamOf = (p: Player, day: number) =>
    season.id === 2025 && p.id === TRADED_PLAYER_ID && day >= GAME_DAYS - TRADE_DAYS ? TRADE_TO : p.teamIdx;
  // Star Clipper's talent scales by season (players[0] is Star Clipper).
  const talentOf = (p: Player) => (p.id === 1 ? { ...p, talent: p.talent * season.starScale } : p);

  function playGame(home: number, away: number, dateMs: number, nbaGameId: number, isPlayoffs: boolean, day: number) {
    gameId++;
    const lines: Line[][] = [home, away].map((teamIdx) => {
      const roster = players.filter((p) => teamOf(p, day) === teamIdx).slice(0, 10);
      return roster.map((p, k) => ({ ...playerLine(talentOf(p), boostOf(teamIdx), k < 5), team_id: teamIdx + 1 }));
    });

    // Scripted Clippers storylines (by LAC game number in the season).
    const lacSide = home === 0 ? 0 : away === 0 ? 1 : -1;
    if (lacSide >= 0 && season.id === 2025) {
      // The play-in counts as the latest game, so closing streaks run through it.
      if (nbaGameId < 50_000_000) lacGamesPlayed++;
      const closing = (n: number) => nbaGameId >= 50_000_000 || lacGamesPlayed > LAC_GAMES - n;
      const star = lines[lacSide][0];
      const big = lines[lacSide][1];
      if (lacGamesPlayed === 20) { star.fg_made = 20; star.fg_attempted = 30; star.fg3_made = 5; star.fg3_attempted = 10; star.ft_made = 10; star.ft_attempted = 11; }
      if (closing(4)) { star.fg_made = Math.max(star.fg_made, 12); star.fg_attempted = Math.max(star.fg_attempted, 22); star.fg3_made = Math.max(star.fg3_made, 3); star.ft_made = Math.max(star.ft_made, 6); star.ft_attempted = Math.max(star.ft_attempted, star.ft_made); }
      if (closing(5)) { big.rebounds = Math.max(big.rebounds, 12); big.offensive_reb = 3; big.defensive_reb = big.rebounds - 3; }
      for (const l of [star]) {
        l.fg3_attempted = Math.max(l.fg3_attempted, l.fg3_made);
        l.points = 2 * (l.fg_made - l.fg3_made) + 3 * l.fg3_made + l.ft_made;
      }
    }

    const totals = lines.map((side) => side.reduce((acc, l) => {
      for (const k of ['points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls',
        'fg_made', 'fg_attempted', 'fg3_made', 'fg3_attempted', 'ft_made', 'ft_attempted',
        'offensive_reb', 'defensive_reb'] as const) acc[k] = (acc[k] ?? 0) + l[k];
      return acc;
    }, {} as Record<string, number>));
    if (totals[0].points === totals[1].points) { // no ties: one more free throw for the home star
      lines[0][0].ft_made++; lines[0][0].ft_attempted++; lines[0][0].points++;
      totals[0].points++; totals[0].ft_made++; totals[0].ft_attempted++;
    }

    const date = new Date(dateMs).toISOString().slice(0, 10);
    games.push({
      game_id: gameId, nba_game_id: nbaGameId, season_id: season.id, game_date: date,
      start_time_utc: new Date(dateMs + 3 * 3600_000).toISOString(), status: 'final',
      home_team_id: home + 1, away_team_id: away + 1,
      home_score: totals[0].points, away_score: totals[1].points, is_playoffs: isPlayoffs,
    });
    [home, away].forEach((teamIdx, side) => {
      teamBoxes.push({ game_id: gameId, team_id: teamIdx + 1, is_home: side === 0, ...totals[side] });
      for (const l of lines[side]) playerBoxes.push({ game_id: gameId, ...l });
    });
  }

  for (season of SEASONS) {
    const yy = season.id % 100;
    let n = 0;
    for (let day = 0; day < GAME_DAYS; day++) {
      // Circle-method round robin: 15 pairings per day, every team plays daily.
      const order = Array.from({ length: 30 }, (_, i) => i);
      const rotated = [order[0], ...order.slice(1).map((_, i) => order[1 + ((i + day) % 29)])];
      for (let k = 0; k < 15; k++) {
        const a = rotated[k];
        const b = rotated[29 - k];
        const [home, away] = day % 2 === 0 ? [a, b] : [b, a];
        playGame(home, away, season.start + day * 2 * 86_400_000, 20_000_000 + yy * 100_000 + ++n, false, day);
      }
    }
  }
  // A 2025-26 Clippers play-in game (must be excluded from regular-season ranks/standings).
  season = SEASONS[1];
  playGame(0, 1, season.start + (GAME_DAYS * 2 + 3) * 86_400_000, 52_500_101, false, GAME_DAYS);

  for (const batch of chunk(games, 500)) await sql`INSERT INTO games ${sql(batch)}`;
  for (const batch of chunk(teamBoxes, 500)) await sql`INSERT INTO game_team_box_scores ${sql(batch)}`;
  for (const batch of chunk(playerBoxes, 500)) await sql`INSERT INTO game_player_box_scores ${sql(batch)}`;
  await sql`SELECT setval('games_game_id_seq', ${gameId})`;
  await sql`SELECT setval('players_player_id_seq', ${players.length})`;
  await sql`SELECT setval('teams_team_id_seq', ${TEAMS.length})`;

  // 2026-27: upcoming Clippers games, the first against GSW.
  const today = Date.now();
  const upcoming = [2, 4, 5].map((opp, i) => ({
    nba_game_id: 22_600_001 + i, season_id: 2026,
    game_date: new Date(today + (10 + 2 * i) * 86_400_000).toISOString().slice(0, 10),
    status: 'scheduled', home_team_id: 1, away_team_id: opp,
  }));
  await sql`INSERT INTO games ${sql(upcoming)}`;

  console.log(`[seed-fixture-league] ${games.length} games, ${playerBoxes.length} player box scores, ${players.length} players`);
  await sql.end();
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

main().catch((err) => {
  console.error('[seed-fixture-league] Failed:', err);
  process.exit(1);
});
