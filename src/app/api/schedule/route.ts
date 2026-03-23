// src/app/api/schedule/route.ts
// GET /api/schedule — Upcoming LAC games with odds (when available).
// Powers the Schedule page.

import { NextResponse } from 'next/server';
import { sql, LAC_NBA_TEAM_ID } from '../../../lib/db.js';
import { buildMeta, buildError } from '../../../lib/api-utils.js';
import { getLatestOdds } from '../../../lib/odds.js';

interface GameRow {
  game_id: string;
  game_date: string;
  season_id: number;
  home_team_id: string;
  away_team_id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  start_time_utc: string | null;
  home_abbr: string;
  away_abbr: string;
  home_city: string;
  away_city: string;
  home_name: string;
  away_name: string;
}

interface TeamRow {
  team_id: string;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeOddsParam = url.searchParams.get('include_odds');
    const includeOdds = includeOddsParam !== 'false';

    // Resolve LAC internal team_id from teams table
    const [lacTeamRow] = await sql<TeamRow[]>`
      SELECT team_id::text AS team_id
      FROM teams
      WHERE nba_team_id = ${LAC_NBA_TEAM_ID}
      LIMIT 1
    `;

    if (!lacTeamRow) {
      return NextResponse.json(
        buildError('INTERNAL_ERROR', 'LAC team record not found in teams table'),
        { status: 500 }
      );
    }

    const lacTeamId = lacTeamRow.team_id;

    // Query upcoming LAC games (game_date >= today, not yet final)
    const games = await sql<GameRow[]>`
      SELECT
        g.game_id::text        AS game_id,
        g.game_date::text      AS game_date,
        g.season_id,
        g.home_team_id::text   AS home_team_id,
        g.away_team_id::text   AS away_team_id,
        g.status,
        g.home_score,
        g.away_score,
        g.start_time_utc::text AS start_time_utc,
        ht.abbreviation        AS home_abbr,
        at.abbreviation        AS away_abbr,
        ht.city                AS home_city,
        at.city                AS away_city,
        ht.name                AS home_name,
        at.name                AS away_name
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE (g.home_team_id = ${lacTeamId}::bigint OR g.away_team_id = ${lacTeamId}::bigint)
        AND g.game_date >= CURRENT_DATE
        AND g.status != 'final'
      ORDER BY g.game_date ASC, g.game_id ASC
      LIMIT 20
    `;

    // Fetch odds in parallel for all games (if requested)
    let oddsResults: Array<Awaited<ReturnType<typeof getLatestOdds>>> = [];
    if (includeOdds && games.length > 0) {
      oddsResults = await Promise.all(games.map((g) => getLatestOdds(g.game_id)));
    }

    // Determine whether odds data was actually returned (for meta.source)
    const hasOdds = oddsResults.some((o) => o !== null);

    // Build response shape for each game
    const gameItems = games.map((g, i) => {
      const isHome = g.home_team_id === lacTeamId;
      const opponentAbbr = isHome ? g.away_abbr : g.home_abbr;
      const homeAway: 'home' | 'away' = isHome ? 'home' : 'away';
      const odds = includeOdds ? (oddsResults[i] ?? null) : null;
      const oddsDisplay = odds ? {
        spread: isHome ? odds.spread_home : odds.spread_away,
        moneyline: isHome ? odds.moneyline_home : odds.moneyline_away,
        over_under: odds.total_points,
        captured_at: odds.captured_at,
      } : null;

      return {
        game_id: g.game_id,
        game_date: g.game_date,
        start_time_utc: g.start_time_utc,
        home_team: {
          team_id: g.home_team_id,
          abbreviation: g.home_abbr,
          city: g.home_city,
          name: g.home_name,
        },
        away_team: {
          team_id: g.away_team_id,
          abbreviation: g.away_abbr,
          city: g.away_city,
          name: g.away_name,
        },
        opponent_abbr: opponentAbbr,
        home_away: homeAway,
        status: g.status,
        odds: oddsDisplay,
      };
    });

    const nextGame = gameItems[0] ?? null;
    const source = includeOdds && hasOdds ? 'mixed' : 'db';

    return NextResponse.json(
      {
        meta: buildMeta(source as 'mixed' | 'db', 1800),
        next_game: nextGame,
        games: gameItems,
      },
      {
        headers: { 'Cache-Control': 'public, max-age=1800' },
      }
    );
  } catch (err) {
    console.error('[GET /api/schedule]', err);
    return NextResponse.json(
      buildError('INTERNAL_ERROR', 'Unexpected server error'),
      { status: 500 }
    );
  }
}
