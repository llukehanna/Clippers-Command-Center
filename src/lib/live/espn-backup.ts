// src/lib/live/espn-backup.ts
// Last-resort score for /live when our runner is stale (spec §6.2 tier 3):
// the browser reads ESPN's public, CORS-enabled scoreboard directly. Score,
// clock and period only — everything runner-derived stays as last seen.

import type { LivePayload } from '../ui/types';

export const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
export const BACKUP_STALE_REASON = 'backup feed (ESPN)';

// ESPN abbreviations that differ from NBA tricodes.
const ESPN_TO_NBA: Record<string, string> = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' };

export interface EspnScore {
  home: number;
  away: number;
  period: number;
  clock: string;
  status: 'scheduled' | 'in_progress' | 'final';
  status_text: string;
}

interface EspnCompetitor { homeAway?: string; score?: string; team?: { abbreviation?: string } }
interface EspnStatus { period?: number; displayClock?: string; type?: { state?: string; shortDetail?: string } }
interface EspnEvent { competitions?: Array<{ competitors?: EspnCompetitor[]; status?: EspnStatus }>; status?: EspnStatus }

const tricode = (abbr: string | undefined) => (abbr ? ESPN_TO_NBA[abbr] ?? abbr : '');

export function espnScoreboardUrl(gameDate: string): string {
  return `${ESPN_SCOREBOARD_URL}?dates=${gameDate.replaceAll('-', '')}`;
}

export function parseEspnScoreboard(json: unknown, homeTricode: string, awayTricode: string): EspnScore | null {
  const events = (json as { events?: EspnEvent[] } | null)?.events ?? [];
  for (const e of events) {
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === 'home');
    const away = comp?.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    if (tricode(home.team?.abbreviation) !== homeTricode || tricode(away.team?.abbreviation) !== awayTricode) continue;
    const st = comp?.status ?? e.status ?? {};
    const state = st.type?.state;
    return {
      home: Number(home.score) || 0,
      away: Number(away.score) || 0,
      period: st.period ?? 0,
      clock: st.displayClock ?? '',
      status: state === 'post' ? 'final' : state === 'in' ? 'in_progress' : 'scheduled',
      status_text: st.type?.shortDetail ?? '',
    };
  }
  return null;
}

export function overlayEspn(p: LivePayload, s: EspnScore): LivePayload {
  if (!p.game) return p;
  return {
    ...p,
    state: 'DATA_DELAYED',
    meta: { ...p.meta, stale: true, stale_reason: BACKUP_STALE_REASON },
    game: {
      ...p.game,
      status: s.status,
      status_text: s.status_text,
      period: s.period,
      clock: s.clock,
      home: { ...p.game.home, score: s.home },
      away: { ...p.game.away, score: s.away },
    },
  };
}
