// scripts/lib/advanced-stats.ts
// Pure formula functions for NBA advanced statistics.
// Source: Dean Oliver "Basketball on Paper" (2004); Basketball-Reference glossary.
// No DB dependency — all functions take plain numbers and return numbers.

// ---- Helpers ----

/**
 * Parse "MM:SS" minutes string to decimal minutes.
 * game_player_box_scores.minutes is TEXT in provider format.
 */
export function parseMinutes(s: string | null | undefined): number {
  if (!s) return 0;
  const [min, sec] = s.split(':').map(Number);
  if (isNaN(min)) return 0;
  return min + (isNaN(sec) ? 0 : sec / 60);
}

// ---- Team-level per-game formulas ----

/**
 * Dean Oliver's simplified possession estimate (team-level).
 * Uses team totals from game_team_box_scores.
 */
export function computeTeamPossessions(bs: {
  fg_attempted: number;
  ft_attempted: number;
  offensive_reb: number;
  turnovers: number;
}): number {
  return bs.fg_attempted + 0.44 * bs.ft_attempted - bs.offensive_reb + bs.turnovers;
}

/**
 * Pace: possessions per 48 minutes (regulation = 48 team minutes).
 * Uses average of both teams' possessions. Default minutes = 48 for regulation.
 */
export function computePace(
  teamPoss: number,
  oppPoss: number,
  minutes: number = 48
): number {
  const avgPoss = (teamPoss + oppPoss) / 2;
  if (minutes === 0) return 0;
  return (avgPoss / minutes) * 48;
}

/**
 * Offensive Rating: points per 100 possessions.
 */
export function computeOffRating(points: number, possessions: number): number {
  if (possessions === 0) return 0;
  return (points / possessions) * 100;
}

/**
 * Effective Field Goal %: weights 3-pointers as 1.5x.
 * Formula: (FGM + 0.5 * FG3M) / FGA
 */
export function computeEfgPct(fgm: number, fg3m: number, fga: number): number {
  if (fga === 0) return 0;
  return (fgm + 0.5 * fg3m) / fga;
}

/**
 * True Shooting %: accounts for 3-pointers and free throws.
 * Formula: PTS / (2 * (FGA + 0.44 * FTA))
 */
export function computeTsPct(points: number, fga: number, fta: number): number {
  const tsa = fga + 0.44 * fta;
  if (tsa === 0) return 0;
  return points / (2 * tsa);
}

/**
 * Turnover Rate: turnovers per 100 plays.
 * Formula: TOV / (FGA + 0.44 * FTA + TOV)
 */
export function computeTovPct(tov: number, fga: number, fta: number): number {
  const denom = fga + 0.44 * fta + tov;
  if (denom === 0) return 0;
  return tov / denom;
}

/**
 * Team Rebound %: share of available rebounds captured by the team.
 * Available = team_oreb + team_dreb + opp_oreb + opp_dreb
 */
export function computeRebPct(
  teamOreb: number,
  teamDreb: number,
  oppOreb: number,
  oppDreb: number
): number {
  const total = teamOreb + teamDreb + oppOreb + oppDreb;
  if (total === 0) return 0;
  return (teamOreb + teamDreb) / total;
}

// ---- Player-level per-game formulas ----

/**
 * Usage Rate: share of team possessions used by player while on floor.
 * Formula: 100 * ((FGA + 0.44*FTA + TOV) * (TmMP/5)) / (MP * (TmFGA + 0.44*TmFTA + TmTOV))
 * team.minutesDecimal = 240 for regulation (team minutes, not sum-of-players).
 */
export function computeUsageRate(
  p: { fg_attempted: number; ft_attempted: number; turnovers: number; minutesDecimal: number },
  team: { fg_attempted: number; ft_attempted: number; turnovers: number; minutesDecimal: number }
): number {
  const playerPart = p.fg_attempted + 0.44 * p.ft_attempted + p.turnovers;
  const teamPart = team.fg_attempted + 0.44 * team.ft_attempted + team.turnovers;
  if (teamPart === 0 || p.minutesDecimal === 0) return 0;
  return 100 * (playerPart * (team.minutesDecimal / 5)) / (p.minutesDecimal * teamPart);
}

/**
 * Assist Rate: % of teammate FGM assisted by player while on floor.
 * Formula: AST / (((MP / (TmMP/5)) * TmFGM) - FGM)
 * Best-effort: denominator can be 0 in edge cases.
 */
export function computeAstRate(
  p: { assists: number; fg_made: number; minutesDecimal: number },
  team: { fg_made: number; minutesDecimal: number }
): number {
  if (team.minutesDecimal === 0 || p.minutesDecimal === 0) return 0;
  const denom = (p.minutesDecimal / (team.minutesDecimal / 5)) * team.fg_made - p.fg_made;
  if (denom <= 0) return 0;
  return 100 * p.assists / denom;
}

/**
 * Rebound Rate: % of available rebounds grabbed by player while on floor.
 * Formula: 100 * (REB * (TmMP/5)) / (MP * (TmREB + OppREB))
 */
export function computeRebRate(
  p: { rebounds: number; minutesDecimal: number },
  team: { rebounds: number; minutesDecimal: number },
  oppRebounds: number
): number {
  const available = team.rebounds + oppRebounds;
  if (available === 0 || p.minutesDecimal === 0 || team.minutesDecimal === 0) return 0;
  return 100 * (p.rebounds * (team.minutesDecimal / 5)) / (p.minutesDecimal * available);
}
