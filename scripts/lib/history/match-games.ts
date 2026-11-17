// scripts/lib/history/match-games.ts
// Decides, read-only, what the Kaggle import does with each game: insert it,
// load an existing row, or leave everything alone. Shared by the writer and
// the dry run, so the dry run reports exactly what a real run would do.
//
// Matching, against all_games (so preseason rows are seen):
//   1. same nba_game_id                                   -> that row
//   2. else same home and away team, game_date within ±1 day. Older provider
//      rows in this DB can be a day off (see findLikelyDuplicates in
//      league-ingest.ts), so an exact-date lookup would duplicate them.
//      - exactly one candidate: that row ("near" when the date differs)
//      - two or more: skipped and reported, never guessed
//   Rows that carry another Kaggle game's id, or sit on another Kaggle game's
//   exact (date, home, away), belong to that game and are not candidates.
// A matched row that already has player box scores is never touched.
import type postgres from 'postgres';
import type { KaggleGame } from './kaggle.js';

type Db = postgres.Sql;

export type GameRow = {
  game_id: string; nba_game_id: string; game_date: string; is_preseason: boolean; has_box: boolean;
};

export type GameDecision =
  | { action: 'insert' }
  | { action: 'update'; row: GameRow }                   // same nba_game_id, no box scores yet
  | { action: 'reuse'; row: GameRow; near: boolean }     // other id, no box scores: re-key to the NBA id
  | { action: 'skip'; reason: 'has_box' | 'preseason' | 'duplicate'; near: boolean; row?: GameRow }
  | { action: 'skip'; reason: 'ambiguous'; near: boolean; candidates: GameRow[] };

export type ClassifiedGame = { game: KaggleGame; homeTeamId: string; awayTeamId: string; decision: GameDecision };

const BATCH = 1000;

export async function classifyGames(
  db: Db,
  games: KaggleGame[],
  teamIdByFranchise: Map<number, string>,
): Promise<ClassifiedGame[]> {
  const teamId = (fid: number, g: KaggleGame) => {
    const t = teamIdByFranchise.get(fid);
    if (!t) throw new Error(`Game ${g.nbaGameId}: franchise ${fid} has no teams row`);
    return t;
  };
  const out: ClassifiedGame[] = [];
  const unique: ClassifiedGame[] = [];
  const keyOwner = new Map<string, number>(); // exact (date|home|away) -> Kaggle game id
  const seenId = new Set<number>();
  for (const g of games) {
    const c: ClassifiedGame = { game: g, homeTeamId: teamId(g.homeFranchiseId, g), awayTeamId: teamId(g.awayFranchiseId, g), decision: { action: 'insert' } };
    const k = `${g.gameDate}|${c.homeTeamId}|${c.awayTeamId}`;
    if (seenId.has(g.nbaGameId) || keyOwner.has(k)) {
      c.decision = { action: 'skip', reason: 'duplicate', near: false };
    } else {
      seenId.add(g.nbaGameId); keyOwner.set(k, g.nbaGameId); unique.push(c);
    }
    out.push(c);
  }

  const hasBox = db.unsafe('EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = a.game_id)');
  const byId = new Map<string, GameRow>();
  for (let i = 0; i < unique.length; i += BATCH) {
    const ids = unique.slice(i, i + BATCH).map((c) => String(c.game.nbaGameId));
    const rows = await db<GameRow[]>`
      SELECT a.game_id::text, a.nba_game_id::text, a.game_date::text, a.is_preseason, ${hasBox} AS has_box
      FROM all_games a WHERE a.nba_game_id = ANY(${ids}::bigint[])`;
    for (const r of rows) byId.set(r.nba_game_id, r);
  }

  const rest = unique.filter((c) => !byId.has(String(c.game.nbaGameId)));
  const candidates = new Map<number, GameRow[]>();
  for (let i = 0; i < rest.length; i += BATCH) {
    const batch = rest.slice(i, i + BATCH);
    // Array params go as text: postgres.js does not serialize number/boolean arrays reliably.
    const rows = await db<(GameRow & { for_id: string; k: string })[]>`
      SELECT v.nid::text AS for_id, a.game_id::text, a.nba_game_id::text, a.game_date::text,
             a.is_preseason, ${hasBox} AS has_box,
             a.game_date::text || '|' || a.home_team_id || '|' || a.away_team_id AS k
      FROM unnest(${batch.map((c) => String(c.game.nbaGameId))}::bigint[], ${batch.map((c) => c.game.gameDate)}::date[],
                  ${batch.map((c) => c.homeTeamId)}::bigint[], ${batch.map((c) => c.awayTeamId)}::bigint[]) AS v(nid, d, h, w)
      JOIN all_games a ON a.home_team_id = v.h AND a.away_team_id = v.w
                      AND a.game_date BETWEEN v.d - 1 AND v.d + 1
      ORDER BY a.game_date, a.game_id`;
    for (const r of rows) {
      const forId = Number(r.for_id);
      if (seenId.has(Number(r.nba_game_id))) continue;           // another Kaggle game's row
      const owner = keyOwner.get(r.k);
      if (owner !== undefined && owner !== forId) continue;      // on another Kaggle game's exact key
      const row: GameRow = { game_id: r.game_id, nba_game_id: r.nba_game_id, game_date: r.game_date, is_preseason: r.is_preseason, has_box: r.has_box };
      candidates.set(forId, [...(candidates.get(forId) ?? []), row]);
    }
  }

  // A row that is the candidate of two Kaggle games is ambiguous for both.
  const claims = new Map<string, number>();
  for (const rows of candidates.values()) for (const r of rows) claims.set(r.game_id, (claims.get(r.game_id) ?? 0) + 1);

  for (const c of unique) {
    const g = c.game;
    const viaId = byId.get(String(g.nbaGameId));
    if (viaId) {
      c.decision = viaId.is_preseason ? { action: 'skip', reason: 'preseason', near: false, row: viaId }
        : viaId.has_box ? { action: 'skip', reason: 'has_box', near: false, row: viaId }
        : { action: 'update', row: viaId };
      continue;
    }
    const cands = candidates.get(g.nbaGameId) ?? [];
    if (cands.length === 0) continue; // insert
    const near = cands.some((r) => r.game_date !== g.gameDate);
    if (cands.length > 1 || claims.get(cands[0].game_id)! > 1) {
      c.decision = { action: 'skip', reason: 'ambiguous', near, candidates: cands };
      continue;
    }
    const row = cands[0];
    c.decision = row.is_preseason ? { action: 'skip', reason: 'preseason', near, row }
      : row.has_box ? { action: 'skip', reason: 'has_box', near, row }
      : { action: 'reuse', row, near };
  }
  return out;
}
