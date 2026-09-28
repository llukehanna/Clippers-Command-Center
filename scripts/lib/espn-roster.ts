// scripts/lib/espn-roster.ts
// Parse ESPN's public team roster endpoint
//   https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{espnTeamId}/roster
// into { name, position, jersey }. Pure — no network, no DB.
//
// NBA rosters come back as a flat `athletes` array; some ESPN sports group
// them (`athletes: [{ position, items: [...] }]`), so both shapes are accepted.

export const ESPN_TEAM_IDS: Record<string, number> = { LAC: 12 };

export interface RosterAthlete {
  espn_id: string | null;
  name: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  jersey: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function parseEspnRoster(json: unknown): RosterAthlete[] {
  if (!isObj(json) || !Array.isArray(json.athletes)) return [];
  const flat = json.athletes.flatMap((a: unknown) =>
    isObj(a) && Array.isArray(a.items) ? a.items : [a]
  );
  const out: RosterAthlete[] = [];
  const seen = new Set<string>();
  for (const a of flat) {
    if (!isObj(a)) continue;
    const name = str(a.displayName) ?? str(a.fullName);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const position = isObj(a.position) ? str(a.position.abbreviation) : null;
    out.push({
      espn_id: a.id == null ? null : String(a.id),
      name,
      first_name: str(a.firstName),
      last_name: str(a.lastName),
      position,
      jersey: str(a.jersey),
    });
  }
  return out;
}

/** A real NBA roster has 13–18 players (incl. two-ways); anything far off means a bad response. */
export function isPlausibleRoster(athletes: RosterAthlete[]): boolean {
  return athletes.length >= 8 && athletes.length <= 25;
}
