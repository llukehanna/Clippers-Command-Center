// Typed views of the API payloads the UI consumes. Field names mirror
// app/api/**/route.ts on main exactly — the UI never reshapes the API.

import type { MetaEnvelope } from '@/src/lib/api-utils'

export type HomeAway = 'home' | 'away'

export interface GameOdds {
  spread: number | null
  moneyline: number | null
  over_under: number | null
  captured_at?: string
}

export interface ScheduleGame {
  game_id: number | string
  game_date: string
  start_time_utc: string | null
  opponent_abbr: string
  home_away: HomeAway
  status?: string
  odds: GameOdds | null
  home_team?: TeamRef
  away_team?: TeamRef
}

export interface TeamRef {
  team_id: string | number
  abbreviation: string
  city?: string
  name?: string
}

export interface TeamSnapshot {
  team_abbr: string
  season_id: number
  record: { wins: number; losses: number }
  conference_seed: number | null
  net_rating: number | null
  off_rating: number | null
  def_rating: number | null
  last_10: { wins: number; losses: number }
  last10_games: Array<{ opponent_abbr: string; game_date: string; margin: number }>
}

export interface PlayerTrend {
  player_id: number | string
  name: string
  window_games: number
  minutes_avg: number | null
  pts_avg: number | null
  reb_avg: number | null
  ast_avg: number | null
  ts_pct: number | null
}

export interface InsightProof {
  summary?: string
  result?: unknown
}

export interface Insight {
  insight_id: string
  scope?: string
  category: string
  headline: string
  detail: string | null
  importance: number
  proof?: InsightProof | null
}

export interface HomePayload {
  meta: MetaEnvelope
  team_snapshot: TeamSnapshot | null
  next_game: ScheduleGame | null
  upcoming_schedule: ScheduleGame[]
  player_trends: PlayerTrend[]
  insights: Insight[]
}

export interface SchedulePayload {
  meta: MetaEnvelope
  next_game: ScheduleGame | null
  games: ScheduleGame[]
}

export interface RosterPlayer {
  player_id: string
  nba_player_id: string | null
  display_name: string
  position: string | null
  is_active: boolean
  is_traded?: boolean
}

export interface PlayersPayload {
  meta: MetaEnvelope
  season_id: number
  players: RosterPlayer[]
}

export type BoxValue = string | number | null

export interface BoxScorePlayer {
  player_id: string
  name: string
  starter?: boolean
  MIN: BoxValue
  PTS: BoxValue
  REB: BoxValue
  AST: BoxValue
  STL: BoxValue
  BLK: BoxValue
  TO: BoxValue
  FG: BoxValue
  '3PT': BoxValue
  FT: BoxValue
  '+/-': BoxValue
  [key: string]: BoxValue | boolean | undefined
}

export interface BoxScoreTeam {
  team_abbr: string
  players: BoxScorePlayer[]
  totals: Record<string, BoxValue>
}

export interface LiveSide {
  team_id: string | null
  abbreviation: string | null
  name: string | null
  score: number | null
  is_home: boolean
}

export interface LiveGame {
  game_id: string
  nba_game_id: string | null
  season_id: number | null
  game_date: string | null
  start_time_utc: string | null
  status: string
  period: number | null
  clock: string | null
  home: LiveSide
  away: LiveSide
}

export interface KeyMetric {
  key: 'efg_pct' | 'tov_margin' | 'reb_margin' | 'pace' | string
  label: string
  value: number | null
  team: 'LAC' | 'GAME' | string
  delta_vs_opp: number | null
}

export interface LiveOdds {
  provider: string
  captured_at: string
  spread_home: number | null
  spread_away: number | null
  moneyline_home: number | null
  moneyline_away: number | null
  total_points: number | null
}

export type LiveState = 'LIVE' | 'DATA_DELAYED' | 'NO_ACTIVE_GAME'

export interface LivePayload {
  meta: MetaEnvelope
  state: LiveState
  snapshot_captured_at?: string
  game: LiveGame | null
  key_metrics: KeyMetric[]
  box_score: { columns: string[]; teams: BoxScoreTeam[] } | null
  insights: Insight[]
  other_games: unknown[]
  odds: LiveOdds | null
}

export interface ChartPoint {
  game_date: string
  value: number | null
}

export interface PlayerGameLogRow {
  game_id: string
  game_date: string
  opp: string
  home_away: HomeAway
  MIN: BoxValue
  PTS: number
  REB: number
  AST: number
  FG: BoxValue
  '3PT': BoxValue
  FT: BoxValue
  '+/-': BoxValue
  ts_pct_computed: number | null
}

export interface PlayerDetailPayload {
  meta: MetaEnvelope
  player: { player_id: string; display_name: string; position: string | null }
  trend_summary: {
    window_games: number
    minutes_avg: number | null
    pts_avg: number | null
    reb_avg: number | null
    ast_avg: number | null
    ts_pct: number | null
    efg_pct: number | null
  } | null
  season_averages: { pts_avg: number | null; reb_avg: number | null; ast_avg: number | null; ts_pct: number | null } | null
  charts: Record<
    | 'rolling_pts_l5' | 'rolling_pts_l10'
    | 'rolling_ts_l5' | 'rolling_ts_l10'
    | 'rolling_reb_l5' | 'rolling_reb_l10'
    | 'rolling_ast_l5' | 'rolling_ast_l10',
    ChartPoint[]
  >
  splits: Record<'home' | 'away' | 'wins' | 'losses', { pts_avg: number | null; ts_pct: number | null }> | null
  game_log: PlayerGameLogRow[]
}

export interface HistoryGameDetailPayload {
  game: {
    game_id: string
    game_date: string
    season_id: number
    home_team: { team_id: string; abbreviation: string }
    away_team: { team_id: string; abbreviation: string }
    status: string
    home_score: number | null
    away_score: number | null
  }
  box_score: { columns: string[]; teams: BoxScoreTeam[]; available: boolean }
  insights: Array<Omit<Insight, 'category'> & { category?: string }>
}
