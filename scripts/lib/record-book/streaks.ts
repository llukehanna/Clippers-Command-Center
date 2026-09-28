// scripts/lib/record-book/streaks.ts
// Streaks of consecutive qualifying games, per entity, from game logs sorted
// by entity then date. A streak breaks on a miss or a team change; one that
// reaches the entity's latest game is active. Pure.

export interface StreakGameBase {
  entityId: string;
  teamId: string;
  gameId: string;
  gameDate: string;   // YYYY-MM-DD
}

export interface PlayerStreakGame extends StreakGameBase {
  pts: number; reb: number; ast: number; stl: number; blk: number; fg3m: number; fgm: number; fga: number;
}

export interface TeamStreakGame extends StreakGameBase {
  won: boolean;
}

export interface StreakDef<G> {
  key: string;
  minLength: number;
  hit: (g: G) => boolean;
}

export interface Streak {
  entityId: string;
  streakKey: string;
  length: number;
  startDate: string;
  endDate: string;
  startGameId: string;
  endGameId: string;
  isActive: boolean;
  teamId: string;
}

const tens = (g: PlayerStreakGame) => [g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length;

export const PLAYER_STREAK_DEFS: StreakDef<PlayerStreakGame>[] = [
  { key: 'scoring_20', minLength: 3, hit: (g) => g.pts >= 20 },
  { key: 'scoring_30', minLength: 3, hit: (g) => g.pts >= 30 },
  { key: 'rebounding_10', minLength: 4, hit: (g) => g.reb >= 10 },
  { key: 'threes_3', minLength: 4, hit: (g) => g.fg3m >= 3 },
  { key: 'hot_shooting', minLength: 4, hit: (g) => g.fga >= 8 && g.fgm * 2 >= g.fga },
  { key: 'double_double', minLength: 4, hit: (g) => tens(g) >= 2 },
];

export const TEAM_STREAK_DEFS: StreakDef<TeamStreakGame>[] = [
  { key: 'wins', minLength: 3, hit: (g) => g.won },
  { key: 'losses', minLength: 3, hit: (g) => !g.won },
];

export function computeStreaks<G extends StreakGameBase>(games: G[], defs: StreakDef<G>[]): Streak[] {
  const out: Streak[] = [];
  const byEntity = new Map<string, G[]>();
  for (const g of games) {
    const list = byEntity.get(g.entityId) ?? [];
    list.push(g);
    byEntity.set(g.entityId, list);
  }

  for (const [entityId, list] of byEntity) {
    for (const def of defs) {
      let start = -1;   // index of the current run's first game, -1 = no run
      const close = (endIdx: number, active: boolean) => {
        const length = endIdx - start + 1;
        if (start >= 0 && length >= def.minLength) {
          out.push({
            entityId, streakKey: def.key, length,
            startDate: list[start].gameDate, endDate: list[endIdx].gameDate,
            startGameId: list[start].gameId, endGameId: list[endIdx].gameId,
            isActive: active, teamId: list[start].teamId,
          });
        }
        start = -1;
      };
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        if (start >= 0 && g.teamId !== list[start].teamId) close(i - 1, false);
        if (def.hit(g)) {
          if (start < 0) start = i;
        } else if (start >= 0) {
          close(i - 1, false);
        }
      }
      if (start >= 0) close(list.length - 1, true);
    }
  }
  return out;
}
