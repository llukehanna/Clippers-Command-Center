// scripts/sync-odds.ts
// Orchestrator: fetch NBA odds, filter to Clippers games, insert into odds_snapshots.
// Provider failure causes a logged warning and clean exit (exit 0) — non-fatal.

import { sql } from './lib/db.js';
import { TheOddsApiAdapter } from './lib/odds-client.js';
import { setCheckpoint } from './lib/upserts.js';
import type { OddsEvent } from '../src/lib/types/odds.js';

async function main(): Promise<void> {
  // Guard: require API key before doing anything
  if (!process.env.ODDS_API_KEY) {
    console.error('ODDS_API_KEY not set');
    process.exit(1);
  }

  const adapter = new TheOddsApiAdapter();

  let events: OddsEvent[] = [];
  try {
    events = await adapter.fetchNBAOdds();
  } catch (err) {
    console.warn('Odds sync failed — skipping:', err);
    process.exit(0);
  }

  // Filter to Clippers games
  const clippersEvents = events.filter(
    e => e.home_team.includes('Clippers') || e.away_team.includes('Clippers')
  );
  console.log(`Found ${clippersEvents.length} Clippers games from provider`);

  let inserted = 0;

  for (const event of clippersEvents) {
    try {
      // Parse game date from commence_time (first 10 chars: "2026-03-08")
      const gameDate = event.commence_time.slice(0, 10);

      // Look up the Clippers team id in teams table
      // Then find the matching game by date and team participation
      const [gameRow] = await sql<{ game_id: string }[]>`
        SELECT game_id::text
        FROM games
        WHERE game_date = ${gameDate}
          AND (
            home_team_id = (
              SELECT team_id FROM teams WHERE name ILIKE '%clippers%' LIMIT 1
            )
            OR
            away_team_id = (
              SELECT team_id FROM teams WHERE name ILIKE '%clippers%' LIMIT 1
            )
          )
        LIMIT 1
      `;

      if (!gameRow) {
        console.warn(`No game_id match for ${event.commence_time} — skipping`);
        continue;
      }

      const gameId = gameRow.game_id;
      const { snapshot } = event;

      // Build raw payload for storage
      const rawPayload = {
        provider_event_id: event.provider_event_id,
        commence_time:     event.commence_time,
        home_team:         event.home_team,
        away_team:         event.away_team,
        ...snapshot,
      };

      await sql`
        INSERT INTO odds_snapshots (
          game_id, provider, captured_at,
          spread_home, spread_away,
          moneyline_home, moneyline_away,
          total_points, raw_payload
        )
        VALUES (
          ${gameId}::bigint, ${adapter.providerKey}, now(),
          ${snapshot.spread_home}, ${snapshot.spread_away},
          ${snapshot.moneyline_home}, ${snapshot.moneyline_away},
          ${snapshot.total_points}, ${sql.json(rawPayload)}
        )
        ON CONFLICT (game_id, provider, captured_at) DO NOTHING
      `;

      console.log(`[${gameDate}] Clippers odds inserted (game_id: ${gameId})`);
      inserted++;
    } catch (err) {
      console.warn('Odds sync failed — skipping:', err);
      process.exit(0);
    }
  }

  // Record successful sync checkpoint
  await setCheckpoint('odds_sync:last_success_at', Date.now());

  console.log(`sync-odds complete: ${inserted} rows inserted`);
}

main();
