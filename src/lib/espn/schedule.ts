// src/lib/espn/schedule.ts
// The Clippers' ESPN team schedule → per-game broadcasts. ESPN's market.type
// ('Home' / 'Away') is unreliable (opponent outlets show up under the
// Clippers' market), so the Clippers' own outlets are recognized by name.

import { espnTricode } from './tricode';

export const espnScheduleUrl = (espnSeason: number) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/12/schedule?season=${espnSeason}`;

export type BroadcastGroup = 'national' | 'clippers' | 'opponent';

export interface Broadcast {
  name: string;
  kind: 'tv' | 'streaming';
  group: BroadcastGroup;
}

export interface EspnScheduledGame {
  espnId: string;
  etDate: string;          // YYYY-MM-DD, US Eastern (matches games.game_date)
  opponent: string;        // NBA tricode
  lacHome: boolean;
  broadcasts: Broadcast[];
}

const CLIPPERS_OUTLETS = /^(ClipperVision|KTLA|KTLA 5|FanDuel Sports Network SoCal)$/i;
const GROUP_ORDER: Record<BroadcastGroup, number> = { national: 0, clippers: 1, opponent: 2 };

interface RawBroadcast { type?: { shortName?: string }; market?: { type?: string }; media?: { shortName?: string } }
interface RawCompetitor { homeAway?: string; team?: { abbreviation?: string } }
interface RawEvent { id?: string; date?: string; competitions?: Array<{ competitors?: RawCompetitor[]; broadcasts?: RawBroadcast[] }> }

const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

export function etDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : ET_DATE.format(d);
}

export function toBroadcasts(raw: RawBroadcast[]): Broadcast[] {
  const byName = new Map<string, Broadcast>();
  for (const b of raw) {
    const name = b.media?.shortName?.trim();
    const type = b.type?.shortName;
    if (!name || type === 'Subscription Package') continue;
    const kind: Broadcast['kind'] = type === 'Streaming' ? 'streaming' : 'tv';
    const group: BroadcastGroup =
      b.market?.type === 'National' ? 'national' : CLIPPERS_OUTLETS.test(name) ? 'clippers' : 'opponent';
    const prev = byName.get(name);
    if (!prev || GROUP_ORDER[group] < GROUP_ORDER[prev.group]) byName.set(name, { name, kind, group });
  }
  return [...byName.values()].sort(
    (a, b) =>
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      (a.kind === b.kind ? 0 : a.kind === 'tv' ? -1 : 1) ||
      a.name.localeCompare(b.name)
  );
}

export function parseEspnSchedule(json: unknown): EspnScheduledGame[] {
  const events = (json as { events?: RawEvent[] } | null)?.events ?? [];
  const out: EspnScheduledGame[] = [];
  for (const e of events) {
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === 'home');
    const away = comp?.competitors?.find((c) => c.homeAway === 'away');
    if (!e.id || !e.date || !home || !away) continue;
    const lacHome = espnTricode(home.team?.abbreviation) === 'LAC';
    out.push({
      espnId: e.id,
      etDate: etDate(e.date),
      opponent: espnTricode((lacHome ? away : home).team?.abbreviation),
      lacHome,
      broadcasts: toBroadcasts(comp?.broadcasts ?? []),
    });
  }
  return out;
}

export function findScheduledGame(games: EspnScheduledGame[], gameDate: string, opponent: string): EspnScheduledGame | null {
  return games.find((g) => g.etDate === gameDate && g.opponent === opponent) ?? null;
}
