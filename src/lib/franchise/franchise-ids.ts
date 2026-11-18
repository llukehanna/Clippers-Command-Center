// src/lib/franchise/franchise-ids.ts
// NBA franchise ids (stats.nba.com) by current tricode — a copy of
// scripts/lib/nba-teams.ts, which app code must not import. Pure.
//
// Franchise columns in the franchise tables (from_franchise_id,
// original_franchise_id, …) hold these ids. They are NOT teams.nba_team_id.

import type { FranchiseTeamRef } from '@/src/lib/ui/types';
import { TEAMS } from '@/src/lib/ui/teams';

export const NBA_FRANCHISE_IDS = {
  ATL: 1610612737, BOS: 1610612738, CLE: 1610612739, NOP: 1610612740, CHI: 1610612741,
  DAL: 1610612742, DEN: 1610612743, GSW: 1610612744, HOU: 1610612745, LAC: 1610612746,
  LAL: 1610612747, MIA: 1610612748, MIL: 1610612749, MIN: 1610612750, BKN: 1610612751,
  NYK: 1610612752, ORL: 1610612753, IND: 1610612754, PHI: 1610612755, PHX: 1610612756,
  POR: 1610612757, SAC: 1610612758, SAS: 1610612759, OKC: 1610612760, TOR: 1610612761,
  UTA: 1610612762, MEM: 1610612763, WAS: 1610612764, DET: 1610612765, CHA: 1610612766,
} as const;

export const CLIPPERS_FRANCHISE_ID = NBA_FRANCHISE_IDS.LAC;

const TRICODE_BY_FRANCHISE_ID: Record<number, string> = Object.fromEntries(
  Object.entries(NBA_FRANCHISE_IDS).map(([tri, id]) => [id, tri]),
);

/** The static current name of a franchise — the last fallback of team resolution (null fields when unknown). */
export function staticTeam(franchiseId: number): FranchiseTeamRef {
  const tri = TRICODE_BY_FRANCHISE_ID[franchiseId] ?? null;
  const t = tri ? TEAMS[tri] : undefined;
  return {
    franchise_id: franchiseId,
    abbreviation: tri,
    name: t?.name ?? null,
    city: t?.city ?? null,
    is_clippers: franchiseId === CLIPPERS_FRANCHISE_ID,
  };
}

/** Heading-safe words for a team with no recorded name. */
export const TEAM_NOT_RECORDED = 'Team not recorded';

/**
 * "Oklahoma City Thunder"; the abbreviation when the name is unknown, else `unknown`
 * ("an unknown team" mid-sentence; pass TEAM_NOT_RECORDED where it stands as a heading).
 */
export function teamFullName(t: FranchiseTeamRef | null, unknown = 'an unknown team'): string {
  if (!t) return unknown;
  if (t.name) return t.city ? `${t.city} ${t.name}` : t.name;
  return t.abbreviation ?? unknown;
}
