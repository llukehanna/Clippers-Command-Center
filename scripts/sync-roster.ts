// scripts/sync-roster.ts
// Current Clippers roster from ESPN's public roster endpoint → app_kv 'roster:LAC'.
// /api/players uses it as the default roster, so players who left in the
// offseason drop off and new signings appear before they've played a game.
//
// Each ESPN athlete is matched to a players row by normalized name (most
// recently active row wins on a tie); athletes with no row yet get one, which
// finalization later claims by name when they first play.
//
// Fails safe: an unreachable endpoint or implausible roster leaves the previous
// snapshot untouched (the API falls back to box-score membership when stale).
//
//   tsx scripts/sync-roster.ts

import { sql } from './lib/db.js';
import { ESPN_TEAM_IDS, isPlausibleRoster, parseEspnRoster, type RosterAthlete } from './lib/espn-roster.js';
import { normalizePersonName, splitPersonName } from './lib/player-match.js';

const TEAM = 'LAC';
const URL = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${ESPN_TEAM_IDS[TEAM]}/roster`;

interface PlayerRow {
  player_id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  position: string | null;
  last_played: string | null;
}

async function fetchRoster(): Promise<RosterAthlete[]> {
  const res = await fetch(URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (clippers-command-center roster sync)', Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ESPN roster HTTP ${res.status}`);
  return parseEspnRoster(await res.json());
}

async function main(): Promise<void> {
  const athletes = await fetchRoster();
  if (!isPlausibleRoster(athletes)) {
    throw new Error(`ESPN roster looks wrong (${athletes.length} athletes); keeping the previous snapshot`);
  }

  const rows = await sql<PlayerRow[]>`
    SELECT p.player_id::text, p.display_name, p.first_name, p.last_name, p.position,
           (SELECT MAX(g.game_date)::text FROM game_player_box_scores pb
              JOIN games g ON g.game_id = pb.game_id WHERE pb.player_id = p.player_id) AS last_played
    FROM players p
  `;
  const byName = new Map<string, PlayerRow[]>();
  for (const r of rows) {
    for (const n of new Set([normalizePersonName(r.display_name), normalizePersonName(`${r.first_name} ${r.last_name}`)])) {
      if (!n) continue;
      byName.set(n, [...(byName.get(n) ?? []), r]);
    }
  }

  const roster: {
    player_id: string;
    name: string;
    position: string | null;
    jersey: string | null;
    espn_id: string | null;
    espn_headshot_url: string | null;
  }[] = [];
  let created = 0;
  for (const a of athletes) {
    const matches = (byName.get(normalizePersonName(a.name)) ?? []).sort((x, y) =>
      (y.last_played ?? '').localeCompare(x.last_played ?? '')
    );
    let playerId = matches[0]?.player_id;
    if (!playerId) {
      const split = splitPersonName(a.name);
      const [inserted] = await sql<{ player_id: string }[]>`
        INSERT INTO players (first_name, last_name, display_name, position, is_active)
        VALUES (${a.first_name ?? split.firstName}, ${a.last_name ?? split.lastName}, ${a.name}, ${a.position}, true)
        RETURNING player_id::text
      `;
      playerId = inserted.player_id;
      created++;
      console.log(`[sync-roster] new player row: ${a.name}`);
    } else if (!matches[0].position && a.position) {
      await sql`UPDATE players SET position = ${a.position}, updated_at = now() WHERE player_id = ${playerId}::bigint`;
    }
    roster.push({
      player_id: playerId,
      name: a.name,
      position: a.position,
      jersey: a.jersey,
      espn_id: a.espn_id,
      espn_headshot_url: a.headshot_url,
    });
  }

  const value = { team: TEAM, source: 'espn', synced_at: new Date().toISOString(), players: roster };
  await sql`
    INSERT INTO app_kv (key, value, updated_at)
    VALUES (${`roster:${TEAM}`}, ${sql.json(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  console.log(`[sync-roster] ${roster.length} players (${created} new rows): ${roster.map((r) => r.name).join(', ')}`);
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('[sync-roster] Failed:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
