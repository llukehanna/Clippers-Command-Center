// scripts/lib/insights/engine/detectors/metrics.ts
// League metrics (moved from v1 league-comparisons.ts). Ratings are
// possession-weighted and summed in float8; proof values are rounded
// (proofValue) so a re-run reproduces them exactly.
import { fmt, pct } from '../../proof-utils.js';

/** Team must have played this many regular-season games to be ranked. */
export const MIN_TEAM_GAMES = 5;

export interface TeamMetric {
  key: string;
  label: string;
  /** SQL aggregate over advanced_team_game_stats `a` (per team, per season). */
  aggregate: string;
  higherIsBetter: boolean;
  format: (v: number) => string;
}

export const TEAM_METRICS: TeamMetric[] = [
  { key: 'off_rating', label: 'offensive rating', higherIsBetter: true,
    aggregate: 'SUM(a.off_rating::float8 * a.possessions) / NULLIF(SUM(a.possessions::float8), 0)', format: (v) => fmt(v) },
  { key: 'def_rating', label: 'defensive rating', higherIsBetter: false,
    aggregate: 'SUM(a.def_rating::float8 * a.possessions) / NULLIF(SUM(a.possessions::float8), 0)', format: (v) => fmt(v) },
  { key: 'net_rating', label: 'net rating', higherIsBetter: true,
    aggregate: 'SUM(a.net_rating::float8 * a.possessions) / NULLIF(SUM(a.possessions::float8), 0)',
    format: (v) => (v > 0 ? `+${fmt(v)}` : fmt(v)) },
  { key: 'efg_pct', label: 'effective FG%', higherIsBetter: true, aggregate: 'AVG(a.efg_pct)', format: (v) => pct(v) },
  { key: 'tov_pct', label: 'turnover rate', higherIsBetter: false, aggregate: 'AVG(a.tov_pct)', format: (v) => pct(v) },
  { key: 'reb_pct', label: 'rebounding rate', higherIsBetter: true, aggregate: 'AVG(a.reb_pct)', format: (v) => pct(v) },
  { key: 'pace', label: 'pace', higherIsBetter: true, aggregate: 'AVG(a.pace)', format: (v) => fmt(v) },
];

export interface PlayerMetric {
  key: string;
  label: string;
  /** SQL over game_player_box_scores `pb`, grouped per player. NULL = unqualified. */
  expr: string;
  format: (v: number) => string;
  topN: number;
}

export const PLAYER_METRICS: PlayerMetric[] = [
  { key: 'ppg', label: 'scoring', expr: 'AVG(pb.points)', format: (v) => `${fmt(v)} PPG`, topN: 25 },
  { key: 'rpg', label: 'rebounding', expr: 'AVG(pb.rebounds)', format: (v) => `${fmt(v)} RPG`, topN: 20 },
  { key: 'apg', label: 'assists', expr: 'AVG(pb.assists)', format: (v) => `${fmt(v)} APG`, topN: 20 },
  { key: 'fg3m', label: 'made threes', expr: 'SUM(pb.fg3_made)', format: (v) => `${Math.round(v)} 3PM`, topN: 20 },
  { key: 'stocks', label: 'steals + blocks', expr: 'AVG(pb.steals + pb.blocks)', format: (v) => `${fmt(v)} per game`, topN: 15 },
  {
    key: 'ts_pct', label: 'true shooting',
    expr: `CASE WHEN AVG(pb.fg_attempted + 0.44 * pb.ft_attempted) >= 10
                THEN SUM(pb.points)::float8 / NULLIF(2 * (SUM(pb.fg_attempted) + 0.44 * SUM(pb.ft_attempted)), 0)
           END`,
    format: (v) => `${pct(v)} TS`, topN: 15,
  },
];
