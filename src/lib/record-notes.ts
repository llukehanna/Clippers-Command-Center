// src/lib/record-notes.ts
// rb_game_highs rows that point at one game → short notes for its postgame
// page ("Kawhi Leonard: 45 points — 4th-most by a Clipper since 2020-21").
// "since" is where complete records start (app_kv insights.records_start /
// insights.pbp_records_start), so a rank is never framed as all-time.

export interface HighRow {
  scope: string;
  stat_key: string;
  rank: number;
  value: number;
  player_id: string | null;
  player: string | null;
}

export interface RecordNote {
  key: string;
  text: string;
}

const SCOPE_ORDER = ['lac_team', 'lac_player', 'player_career', 'player_season', 'league_season'];
const MAX_RANK: Record<string, number> = { lac_team: 10, lac_player: 10, player_career: 3, player_season: 1, league_season: 5 };
const PBP_STATS = new Set(['q_pts', 'team_q_pts', 'half_pts']);

const LABEL: Record<string, string> = {
  pts: 'points', reb: 'rebounds', ast: 'assists', fg3m: 'threes', stl: 'steals', blk: 'blocks',
  fgm: 'field goals', ftm: 'free throws', tov: 'turnovers',
  team_pts: 'points', team_fg3m: 'threes', team_ast: 'assists',
  team_q_pts: 'points in a quarter', q_pts: 'points in a quarter', half_pts: 'points in a half',
};

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

export function seasonLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

const most = (rank: number) => (rank === 1 ? 'most' : `${ordinal(rank)}-most`);

function teamText(r: HighRow, since: string): string {
  const v = Math.round(r.value);
  if (r.stat_key === 'margin') return `${v}-point win — the Clippers' ${r.rank === 1 ? 'biggest' : `${ordinal(r.rank)}-biggest`}${since}`;
  if (r.stat_key === 'opp_pts_low') return `Held the opponent to ${v} points — the Clippers' ${r.rank === 1 ? 'fewest' : `${ordinal(r.rank)}-fewest`} allowed${since}`;
  return `${v} ${LABEL[r.stat_key] ?? r.stat_key} — ${most(r.rank)} by the Clippers${since}`;
}

function noteText(r: HighRow, starts: { records: number | null; pbp: number | null }): string {
  const start = PBP_STATS.has(r.stat_key) ? starts.pbp : starts.records;
  const since = start == null ? '' : ` since ${seasonLabel(start)}`;
  if (r.scope === 'lac_team') return teamText(r, since);
  const what = `${r.player ?? 'A player'}: ${Math.round(r.value)} ${LABEL[r.stat_key] ?? r.stat_key}`;
  switch (r.scope) {
    case 'lac_player': return `${what} — ${most(r.rank)} by a Clipper${since}`;
    case 'player_career': return `${what} — ${r.rank === 1 ? 'career high' : `${ordinal(r.rank)}-best career game`}`;
    case 'player_season': return `${what} — season high`;
    default: return `${what} — ${r.rank === 1 ? 'the most' : most(r.rank)} in the NBA this season`;
  }
}

export function recordNotes(rows: HighRow[], starts: { records: number | null; pbp: number | null }, max = 6): RecordNote[] {
  const best = new Map<string, HighRow>();
  for (const r of rows) {
    const order = SCOPE_ORDER.indexOf(r.scope);
    if (order === -1 || r.rank > (MAX_RANK[r.scope] ?? 0)) continue;
    const key = `${r.player_id ?? 'team'}:${r.stat_key}`;
    const prev = best.get(key);
    if (!prev || order < SCOPE_ORDER.indexOf(prev.scope) || (order === SCOPE_ORDER.indexOf(prev.scope) && r.rank < prev.rank)) {
      best.set(key, r);
    }
  }
  return [...best.values()]
    .sort((a, b) => SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope) || a.rank - b.rank)
    .slice(0, max)
    .map((r) => ({ key: `${r.scope}:${r.player_id ?? 'team'}:${r.stat_key}`, text: noteText(r, starts) }));
}
