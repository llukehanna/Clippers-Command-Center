// scripts/lib/pbp/espn.ts
// ESPN's game summary → the cdn play-by-play shape the normalizer reads. The
// post-game ingest uses it when cdn.nba.com refuses us (403 for every client
// outside nba.com since late October 2026).
//
// Builds on the live runner's converter (toActions) and adds what a stored
// game needs beyond it: the assist on a made shot, steal and block actions
// (ESPN folds them into the turnover / missed shot as the second participant),
// and shot locations. Player ids come from the same name resolver, so an
// unmatched player keeps a negative id and is skipped like any unknown player.
import {
  athleteNames,
  fetchEspnScoreboard,
  fetchEspnSummary,
  toActions,
  toScoreboard,
  tricodeOf,
  type EspnPlay,
  type EspnSummaryJson,
  type PersonIdResolver,
} from '../espn-live-client.js';
import type { RawAction, RawPlayByPlay } from './types.js';

const HALF_COURT = { width: 50, length: 94 };

/** ESPN's coordinate in feet, or null for its off-court sentinel (free throws, some non-shots). */
function shotLocation(p: EspnPlay): { shotX: number; shotY: number } | null {
  const x = p.coordinate?.x;
  const y = p.coordinate?.y;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (x < 0 || x > HALF_COURT.width || y < 0 || y > HALF_COURT.length) return null;
  return { shotX: x, shotY: y };
}

export function espnToRaw(json: EspnSummaryJson, nbaGameId: string, resolve: PersonIdResolver): RawPlayByPlay {
  const names = athleteNames(json);
  const person = (id: string | undefined) => (id ? resolve(id, names.get(id) ?? '') : null);
  const tricodes = (json.header?.competitions?.[0]?.competitors ?? []).map((c) => tricodeOf(c.team?.abbreviation));
  const opponentOf = (tri: string) => tricodes.find((t) => t && t !== tri) ?? null;
  // toActions numbers a play's action sequenceNumber * 2; that finds the play again.
  const plays = new Map((json.plays ?? []).map((p) => [Number(p.sequenceNumber ?? 0) * 2, p]));

  const actions: RawAction[] = [];
  for (const a of toActions(json, resolve, names)) {
    const p = a.actionType === 'substitution' ? undefined : plays.get(a.actionNumber);
    const second = person(p?.participants?.[1]?.athlete?.id);
    const isFg = a.actionType === '2pt' || a.actionType === '3pt';
    actions.push({
      actionNumber: a.actionNumber,
      clock: a.clock,
      period: a.period,
      teamTricode: a.teamTricode || null,
      personId: a.personId || null,
      actionType: a.actionType,
      subType: a.subType,
      shotResult: a.shotResult ?? null,
      assistPersonId: isFg && a.shotResult === 'Made' ? second : null,
      scoreHome: a.scoreHome,
      scoreAway: a.scoreAway,
      description: a.description,
      ...(isFg && p ? shotLocation(p) : null),
    });
    if (!p || second === null) continue;

    // The defender's credit, as the CDN logs it: its own action right after, for the other team.
    const text = p.text ?? '';
    const credit =
      a.actionType === 'turnover' && /\bsteals\)/.test(text) ? 'steal'
        : isFg && a.shotResult === 'Missed' && /\bblocks\b/.test(text) ? 'block'
          : null;
    if (credit) {
      actions.push({
        actionNumber: a.actionNumber + 1, // odd numbers are free outside substitutions
        clock: a.clock,
        period: a.period,
        teamTricode: opponentOf(a.teamTricode),
        personId: second,
        actionType: credit,
        subType: '',
        scoreHome: a.scoreHome,
        scoreAway: a.scoreAway,
        description: text,
      });
    }
  }
  return { game: { gameId: nbaGameId.padStart(10, '0'), actions } };
}

export interface EspnGame {
  nbaGameId: string;
  /** US Eastern date, YYYY-MM-DD (games.game_date). */
  gameDate: string;
  homeTricode: string;
  awayTricode: string;
}

/** Finds the game on ESPN's scoreboard for its date; null when ESPN doesn't list it. */
export async function fetchEspnPbp(game: EspnGame, resolve: PersonIdResolver): Promise<RawPlayByPlay | null> {
  const { match } = toScoreboard(await fetchEspnScoreboard(game.gameDate), game);
  if (!match) return null;
  return espnToRaw(await fetchEspnSummary(match.espnEventId), game.nbaGameId, resolve);
}
