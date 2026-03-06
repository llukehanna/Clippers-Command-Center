// scripts/types/bdl.ts
// BALLDONTLIE v1 API response types
// Ref: https://docs.balldontlie.io/

export interface BDLTeam {
  id: number;
  abbreviation: string;
  city: string;
  conference: string;
  division: string;
  full_name: string;
  name: string;
}

export interface BDLPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height: string | null;        // "6-5" format from API
  weight_pounds: string | null; // "215" format from API
  birthdate: string | null;
  jersey_number: string | null;
  college: string | null;
  country: string | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  is_active: boolean;
  team: BDLTeam | null;
}

export interface BDLGame {
  id: number;
  date: string;               // "2022-10-18" (game date)
  season: number;             // start year, e.g. 2022
  status: string;             // "Final", "2024-10-18T00:00:00.000Z" (scheduled), or time string
  period: number;
  time: string | null;        // clock string, e.g. "05:32"
  postseason: boolean;
  home_team: BDLTeam;
  home_team_score: number;
  visitor_team: BDLTeam;
  visitor_team_score: number;
}

export interface BDLStat {
  id: number;
  ast: number | null;
  blk: number | null;
  dreb: number | null;
  fg3_pct: number | null;
  fg3a: number | null;
  fg3m: number | null;
  fg_pct: number | null;
  fga: number | null;
  fgm: number | null;
  ft_pct: number | null;
  fta: number | null;
  ftm: number | null;
  game: { id: number; date: string; season: number; postseason: boolean; home_team_id: number; visitor_team_id: number };
  min: string | null;         // "34:12" format
  oreb: number | null;
  pf: number | null;
  player: BDLPlayer;
  pts: number | null;
  reb: number | null;
  stl: number | null;
  team: BDLTeam;
  turnover: number | null;
}

export interface BDLPaginatedResponse<T> {
  data: T[];
  meta: {
    next_cursor: number | null;
    per_page: number;
  };
}
