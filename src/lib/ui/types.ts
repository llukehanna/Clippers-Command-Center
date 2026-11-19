// Typed views of the API payloads the UI consumes. Field names mirror
// app/api/**/route.ts on main exactly — the UI never reshapes the API.

import type { MetaEnvelope } from '@/src/lib/api-utils'
import type { Broadcast } from '../espn/schedule'
import type { InjuryEntry } from '../espn/injuries'
import type { LineupState, LivePhase, LivePlay, LiveFlow, LiveWinProb } from '../types/live-state'
import type { PlayerInjury } from '../types/live'
import type { Shot } from '../shots'
import type { InsightCardData, MatchupNote } from '../insights/card'
import type { BoxTags } from '../data/season-highs'
import type { RecordNote } from '../record-notes'

export type { InsightCardData, MatchupNote } from '../insights/card'

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
  /** Preseason: can be the next game, never part of the schedule or record. */
  is_preseason?: boolean
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
  /** Real NBA person id (headshots). nba_player_id is a legacy provider id. */
  nba_person_id?: number | string | null
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

export interface HomeFeeds {
  hero: InsightCardData | null
  recent: InsightCardData[]
  season: InsightCardData[]
  scouting: InsightCardData[]
  notes: MatchupNote[]
}

export interface HomePayload {
  meta: MetaEnvelope & { last_sync_at?: string | null }
  team_snapshot: TeamSnapshot | null
  next_game: ScheduleGame | null
  upcoming_schedule: ScheduleGame[]
  player_trends: PlayerTrend[]
  insights: Insight[]
  feeds: HomeFeeds
}

export interface SchedulePayload {
  meta: MetaEnvelope
  next_game: ScheduleGame | null
  games: ScheduleGame[]
}

export interface RosterPlayer {
  player_id: string
  nba_player_id: string | null
  /** Real NBA person id (headshots). */
  nba_person_id?: number | string | null
  jersey?: string | null
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
  /** NBA-sourced box scores (live and history) key this by the NBA personId (number). */
  player_id: number | string
  nba_person_id?: number | string | null
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
  [key: string]: BoxValue | boolean | undefined | number | string | null
}

export interface BoxScoreTeam {
  team_abbr: string
  /** History only: true for the Clippers side, decided by team identity (era abbreviations vary). */
  is_lac?: boolean
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
  status_text?: string | null
  periods?: LinePeriod[]
  /** Preseason: shown live, but never counted in records or stats. */
  is_preseason?: boolean
  home: LiveSide
  away: LiveSide
}

export interface LinePeriod {
  period: number
  home: number
  away: number
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
  /** When the runner built the snapshot behind a LIVE / DATA_DELAYED response (server clock). */
  snapshot_captured_at?: string
  game: LiveGame | null
  key_metrics: KeyMetric[]
  box_score: { columns: string[]; teams: BoxScoreTeam[] } | null
  insights: Insight[]
  other_games: unknown[]
  odds: LiveOdds | null
  cadence?: { phase: LivePhase; next_ms: number } | null
  /** Pre-tip: the game the runner is already watching, so clients can connect early. */
  upcoming?: { nba_game_id: string } | null
  /** Game flow series + markers (Live v2 Plan 3); null before tip. */
  flow?: LiveFlow | null
  /** Model win probability; a model estimate, labeled as one. */
  wp?: LiveWinProb | null
  /** Rotation clipboard; null until both box scores exist. */
  lineups?: LineupState | null
  /** NBA wall-clock time of the newest play in this state (spoiler sync). */
  observed_at?: string | null
  /** The newest plays, newest first (at most 25). */
  plays?: LivePlay[]
  /** Who's out for each side and why; null when the feed has no report. */
  injuries?: { lac: PlayerInjury[]; opp: PlayerInjury[] } | null
}

export interface ChartPoint {
  game_date: string
  value: number | null
}

export interface PlayerGameLogRow {
  game_id: string
  game_date: string
  game_type?: 'regular' | 'play_in' | 'playoffs'
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
    home_team: { team_id: string; abbreviation: string; name?: string; is_lac?: boolean }
    away_team: { team_id: string; abbreviation: string; name?: string; is_lac?: boolean }
    status: string
    home_score: number | null
    away_score: number | null
    periods?: LinePeriod[]
  }
  box_score: { columns: string[]; teams: BoxScoreTeam[]; available: boolean; tags: BoxTags }
  /** Postgame cards that passed the quality bar, composed (Q4 merge, at most 8), plus live and pre-v2 rows. */
  game_story: InsightCardData[]
  insights: Array<Omit<Insight, 'category'> & { category?: string }>
}

export type MediaKind = 'article' | 'reddit' | 'tweet' | 'bluesky'

/** News/social item from /api/media — external content, never "verified". */
export interface MediaItem {
  media_id: string
  kind: MediaKind
  source: string
  url: string
  title: string
  author: string | null
  published_at: string
  engagement: number | null
  comments: number | null
  thumbnail_url: string | null
  embed_url: string | null
  feed_rank: number | null
}

export interface MediaPayload {
  meta: MetaEnvelope
  articles: MediaItem[]
  social: MediaItem[]
}

// ─── Franchise (/api/franchise/*) ────────────────────────────────────────────
// Unknown is null end to end: never coerced to 0, false or ''.

/** A franchise in a given season, with that era's name (Buffalo Braves, Seattle SuperSonics…). */
export interface FranchiseTeamRef {
  /** NBA franchise id (1610612746 = Clippers), not teams.nba_team_id. */
  franchise_id: number
  abbreviation: string | null
  name: string | null
  city: string | null
  is_clippers: boolean
}

/** A person from person_xref; href is their player page when they have one. */
export interface FranchisePersonRef {
  person_key: string
  name: string
  player_id: string | null
  /** NBA person id for the headshot (person_xref's, else the linked player's); null when unknown. */
  nba_person_id: number | null
  href: string | null
}

/** Moves `type` filter: kind groups (R2). */
export type MoveKindGroup = 'trade' | 'signing' | 'release' | 'draft' | 'other'
export type MoveTypeFilter = MoveKindGroup | 'all'

export interface MoveRow {
  slug: string
  date: string | null
  season_id: number | null
  kind: string
  kind_group: MoveKindGroup
  /** Our generated sentence. */
  description: string
  /** false → "details pending". */
  is_complete: boolean
  /** Trade page link; null for non-trades. */
  href: string | null
  /** Every franchise in the move, era names, Clippers first. */
  teams: FranchiseTeamRef[]
  /** Distinct people in the move (R3), in part order. */
  people: FranchisePersonRef[]
}

export interface MovesPayload {
  meta: MetaEnvelope
  filters: { season: number | null; type: MoveTypeFilter | null; player: string | null }
  /** Seasons with at least one Clippers move, newest first. [] for a bounded request (limit or player_id, not season=latest). */
  seasons: number[]
  /** Moves per season for the type and player filters (season filter ignored), newest first. [] when `seasons` is skipped. */
  season_counts: Array<{ season_id: number; count: number }>
  /** The person named by the player filter; null without one or when unknown. */
  player: FranchisePersonRef | null
  moves: MoveRow[]
}

/** A person in Clippers moves, for the Moves player search (/api/franchise/people). */
export interface MovePerson extends FranchisePersonRef {
  move_count: number
}

export interface PeoplePayload {
  meta: MetaEnvelope
  /** By name. */
  people: MovePerson[]
}

/** One trade that moved a pick. */
export interface PickHop {
  slug: string
  date: string | null
  href: string | null
  from: FranchiseTeamRef | null
  to: FranchiseTeamRef | null
}

export interface DraftLottery {
  pre_lottery_slot: number | null
  /** Odds of landing #1 as stored in draft_lottery.odds_first; null renders —. */
  odds_first: number | null
  pick_won: number | null
  tie_unresolved: boolean | null
  /** pick_won vs pre_lottery_slot; null when either is unknown. */
  movement: 'jumped' | 'fell' | 'held' | null
  source: 'wiki' | 'derived'
}

export interface DraftPick {
  pick_key: string
  draft_year: number
  round: number
  overall_pick: number | null
  status: string | null
  player: FranchisePersonRef | null
  /** "from X" (the Clippers when it was their own pick). */
  original_team: FranchiseTeamRef
  /** "via Y": owners between the original team and the final owner, in order. */
  via: FranchiseTeamRef[]
  /** Who used it (the destination of a traded-away pick). */
  owner: FranchiseTeamRef | null
  /** The Clippers owned it once but someone else used it — render dimmed. */
  traded_away: boolean
  chain: PickHop[]
  lottery: DraftLottery | null
}

export interface DraftPayload {
  meta: MetaEnvelope
  /** Newest year first. */
  years: Array<{ draft_year: number; picks: DraftPick[] }>
}

export interface ContractSeason {
  season_id: number
  amount_usd: number | null
  guaranteed_usd: number | null
  option: 'player' | 'team' | 'early_termination' | null
}

export interface PayrollSeason {
  season_id: number
  season_label: string
  listed_players: number | null
  roster_players: number | null
  listed_total_usd: number | null
  is_partial: boolean | null
}

export interface ContractsPayload {
  meta: MetaEnvelope
  /** Newest snapshot only; null when there is none. */
  snapshot_id: string | null
  snapshot_fetched_at: string | null
  /** Cap-sheet columns, ascending. */
  seasons: number[]
  /** Highest first-season amount first. */
  players: Array<{ person: FranchisePersonRef; seasons: ContractSeason[] }>
  /** Per season; null when any listed amount is unknown. */
  totals: Array<{ season_id: number; amount_usd: number | null }>
  /** From 1984-85, newest first. */
  payroll: PayrollSeason[]
}

export interface TradeLink {
  slug: string
  href: string
  date: string | null
}

/**
 * held: the Clippers hold it. owed: someone else holds a pick/right the Clippers gave.
 * uncertain: a Clippers pick with no linked trade out, but a Clippers trade sent an
 * unidentified pick of the same year and round — "may have been traded; details not recorded".
 */
export type PickHolderStatus = 'held' | 'owed' | 'uncertain'

export interface OwedAsset {
  kind: 'pick' | 'swap'
  holder_status: PickHolderStatus
  key: string
  draft_year: number
  round: number
  /** Picks: the original team. Swaps: null. */
  original_team: FranchiseTeamRef | null
  /**
   * Current holder: the receiver of the latest linked trade part (the original team when no
   * part links it). Swaps: who holds the right. null when unknown (uncertain, or no receiver).
   */
  owner: FranchiseTeamRef | null
  /** The other team: owner (owed), original team (held), the other swap party, where it may have gone (uncertain). */
  counterparty: FranchiseTeamRef | null
  /** Originally the Clippers' own pick. */
  is_own: boolean
  protections: unknown | null
  protections_text: string | null
  protections_known: boolean | null
  /** Plain words; "Protections not recorded" unless protections_known is true. */
  protections_label: string
  /** Held: the trade it came in. Owed: the trade it went out in. Uncertain: the trade that may have sent it. */
  trade: TradeLink | null
  /** Uncertain: "may have been traded; details not recorded" (or "holder not recorded"); else null. */
  note: string | null
  gap_notes: string[]
}

export interface PicksOwedPayload {
  meta: MetaEnvelope
  /** By draft year, round; picks before swaps. holder_status 'held'. */
  owned: OwedAsset[]
  /** holder_status 'owed'. */
  owed: OwedAsset[]
  /** Clippers picks that may have been traded without a link; holder_status 'uncertain', owner null. */
  uncertain: OwedAsset[]
}

export interface CoachSeason {
  season_id: number
  season_label: string
  /** Order within the season (mid-season changes). */
  ordinal: number
  coach: FranchisePersonRef
  games: number | null
  wins: number | null
  losses: number | null
  playoff_wins: number | null
  playoff_losses: number | null
}

export interface ExecutiveTerm {
  person: FranchisePersonRef
  title: string | null
  start_date: string | null
  end_date: string | null
}

export interface FrontOfficePayload {
  meta: MetaEnvelope
  /** Newest season first, ordinal ascending within a season. */
  coach_seasons: CoachSeason[]
  /** Newest start first. */
  executives: ExecutiveTerm[]
}

export interface HonorRow {
  season_id: number | null
  honor: string
  label: string
  detail: string | null
  person: FranchisePersonRef
}

export interface HonorsPayload {
  meta: MetaEnvelope
  /** Numbers the Clippers retired (none so far). */
  retired_number: HonorRow[]
  /** Numbers the whole league retired (Bill Russell's No. 6). */
  retired_number_league: HonorRow[]
  /** season_id null; detail = induction year. */
  hall_of_fame: HonorRow[]
  /** Newest season first. */
  awards_by_season: Array<{ season_id: number; season_label: string; honors: HonorRow[] }>
  /** Unseasoned honors of any other code. */
  other: HonorRow[]
}

export type TradeAssetKind = 'player' | 'draft_rights' | 'pick' | 'swap' | 'cash' | 'exception' | 'other'

export interface TradeAsset {
  kind: TradeAssetKind
  label: string
  href: string | null
  person: FranchisePersonRef | null
  pick: {
    pick_key: string
    draft_year: number
    round: number
    original_team: FranchiseTeamRef
    overall_pick: number | null
    status: string | null
    protections_known: boolean | null
    protections_text: string | null
    protections_label: string
  } | null
  swap: {
    swap_key: string
    draft_year: number
    round: number
    teams: FranchiseTeamRef[]
    exercised: boolean | null
    protections_known: boolean | null
    protections_text: string | null
    protections_label: string
  } | null
  /** The other team: sender for received assets, receiver for sent ones; null when not stated. */
  counterparty: FranchiseTeamRef | null
  gap_reason: string | null
  gap_note: string | null
}

/** One side per franchise in the trade, Clippers first (R4). */
export interface TradeSide {
  team: FranchiseTeamRef
  received: TradeAsset[]
  sent: TradeAsset[]
}

/** One row of the "What it became" outline. */
export interface TreeNode {
  label: string
  kind: 'player' | 'pick' | 'swap' | 'cash' | 'other'
  href: string | null
  /** Quiet gap/terminal note: 'protections not recorded', 'no further record', 'traded on to T (details not recorded)'. */
  note: string | null
  children: TreeNode[]
  /** Depth limit reached: slug of the trade page to continue on. */
  truncatedAt: string | null
  /** The player on this row (asset, next move or drafted player), with the headshot id; null otherwise. */
  person: FranchisePersonRef | null
  /** Date of the event (null for the asset rows). */
  date: string | null
  /** Who holds the asset after this row. */
  team: FranchiseTeamRef | null
}

export interface TradePayload {
  meta: MetaEnvelope
  trade: {
    slug: string
    date: string | null
    season_id: number | null
    kind: string
    description: string
    is_complete: boolean
    involves_clippers: boolean
    sources: string[]
  }
  /** Every franchise in the trade, era names, Clippers first. */
  teams: FranchiseTeamRef[]
  sides: TradeSide[]
  /** Distinct gap notes of the trade's parts. */
  gap_notes: string[]
  became: TreeNode[]
}

// ─── Game preview (/schedule/[game_id]) ──────────────────────────────────────

export type { Broadcast, InjuryEntry }

export interface PreviewRank { value: number; rank: number; of: number }

export interface PreviewTeamForm {
  record: { wins: number; losses: number } | null
  last10: { wins: number; losses: number; net_rating: number | null } | null
  ranks: { off: PreviewRank; def: PreviewRank; net: PreviewRank } | null
  days_since_last: number | null
}

export interface PreviewMeeting {
  game_id: string
  game_date: string
  season_id: number
  lac_home: boolean
  lac_score: number
  opp_score: number
  won: boolean
}

export interface GamePreviewPayload {
  meta: MetaEnvelope
  game: ScheduleGame & { game_id: string; status: string; arena: string | null; season_id: number }
  broadcasts: Broadcast[] | null
  injuries: { updated_at: string | null; lac: InjuryEntry[]; opp: InjuryEntry[] } | null
  line: {
    current: { spread: number | null; moneyline: number | null; over_under: number | null; captured_at: string } | null
    movement: { t: string; spread: number }[]
    win_prob: { lac: number; source: 'spread' | 'home_court' }
  } | null
  matchup: {
    season_series: { wins: number; losses: number } | null
    meetings: PreviewMeeting[] | null
    lac: PreviewTeamForm
    opp: PreviewTeamForm
  }
  insights: Insight[]
}

// ─── Game story (/history/[game_id]) ─────────────────────────────────────────

export type { Shot, RecordNote }

export interface StoryPeriodLine { pts: number; fgm: number; fga: number; fg3m: number; fg3a: number; ftm: number; fta: number }
export interface StoryClutchLine { pts: number; fgm: number; fga: number; fg3m: number; ftm: number; fta: number; tov: number }

export interface GameStoryPayload {
  meta: MetaEnvelope
  game_id: string
  opp_abbr: string
  flow: {
    flow: LiveFlow
    expected_source: 'spread' | 'home_court'
    summary: { largest_lead: number; largest_deficit: number; lead_changes: number; times_tied: number; lac_best_run: number; opp_best_run: number }
  } | null
  quarters: Array<{ period: number; lac: StoryPeriodLine; opp: StoryPeriodLine; lac_top: { name: string; pts: number } | null }> | null
  clutch: { lac: StoryClutchLine; opp: StoryClutchLine | null; players: Array<{ name: string; pts: number; fgm: number; fga: number }> } | null
  shots: { shots: Shot[]; located: number; total: number } | null
  records: RecordNote[] | null
}
