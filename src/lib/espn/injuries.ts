// src/lib/espn/injuries.ts
// ESPN's league-wide injury report → entries per NBA tricode. Status, body
// part and ESPN's estimated return only: the comments are Rotowire text and
// are never kept.

import { espnTricode } from './tricode';

export const ESPN_INJURIES_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';

export interface InjuryEntry {
  name: string;
  status: string;
  injury: string | null;        // "Left ankle soreness"
  return_date: string | null;   // YYYY-MM-DD, ESPN's estimate
  updated: string | null;       // ISO
}

export interface InjuryReport {
  fetched_at: string | null;
  byTeam: Record<string, InjuryEntry[]>;
}

interface RawDetails { type?: string | null; detail?: string | null; side?: string | null; returnDate?: string | null }
interface RawInjury { status?: string; date?: string; athlete?: { displayName?: string; team?: { abbreviation?: string } }; details?: RawDetails }
interface RawTeam { injuries?: RawInjury[] }

const STATUS_ORDER = ['out', 'doubtful', 'questionable', 'day-to-day', 'probable'];

export function statusRank(status: string): number {
  const i = STATUS_ORDER.indexOf(status.toLowerCase());
  return i === -1 ? STATUS_ORDER.length : i;
}

const specified = (s: string | null | undefined) => (s && s.trim() && s.trim() !== 'Not Specified' ? s.trim() : null);

export function injuryText(details: RawDetails | undefined): string | null {
  const type = specified(details?.type);
  if (!type) return null;
  const side = specified(details?.side);
  const detail = specified(details?.detail);
  const part = side ? `${side} ${type.toLowerCase()}` : type;
  return detail ? `${part} ${detail.toLowerCase()}` : part;
}

export function parseEspnInjuries(json: unknown): InjuryReport {
  const root = json as { timestamp?: string; injuries?: RawTeam[] } | null;
  const byTeam: Record<string, InjuryEntry[]> = {};
  for (const team of root?.injuries ?? []) {
    for (const i of team.injuries ?? []) {
      const tricode = espnTricode(i.athlete?.team?.abbreviation);
      const name = i.athlete?.displayName?.trim();
      if (!tricode || !name) continue;
      (byTeam[tricode] ??= []).push({
        name,
        status: i.status ?? 'Unknown',
        injury: injuryText(i.details),
        return_date: i.details?.returnDate ?? null,
        updated: i.date ?? null,
      });
    }
  }
  for (const list of Object.values(byTeam)) {
    list.sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name));
  }
  return { fetched_at: root?.timestamp ?? null, byTeam };
}
