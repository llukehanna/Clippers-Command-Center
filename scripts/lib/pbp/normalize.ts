// scripts/lib/pbp/normalize.ts
// cdn.nba.com liveData and stats.nba.com playbyplayv3 → one PbpEvent stream.
// Points come from score changes (robust to both formats and to corrections);
// shot classification comes from actionType. Pure — no DB, no network.
import { normalizeTricode } from '../stats-nba.js';
import type { NormalizedPbp, PbpEvent, PbpSource, RawAction, RawPlayByPlay } from './types.js';

const REGULATION_PERIOD_SEC = 720;
const OT_PERIOD_SEC = 300;

/** "PT11M40.00S" → 700 (seconds left in the period). */
export function clockSeconds(iso: string): number {
  const m = /PT(\d+)M([\d.]+)S/.exec(iso ?? '');
  return m ? Number(m[1]) * 60 + Math.floor(Number(m[2])) : 0;
}

/** Seconds since tip for a period and time left in it. */
export function elapsedSeconds(period: number, clockSec: number): number {
  if (period <= 4) return (period - 1) * REGULATION_PERIOD_SEC + (REGULATION_PERIOD_SEC - clockSec);
  return 4 * REGULATION_PERIOD_SEC + (period - 5) * OT_PERIOD_SEC + (OT_PERIOD_SEC - clockSec);
}

type Classified = Pick<PbpEvent, 'kind' | 'made' | 'shotValue'>;
const OTHER: Classified = { kind: 'other', made: null, shotValue: null };
const missedFromText = (a: RawAction) => /\bMISS\b/i.test(a.description ?? '');

function classifyCdn(a: RawAction): Classified {
  switch ((a.actionType ?? '').toLowerCase()) {
    case '2pt': return { kind: 'fg', made: a.shotResult === 'Made', shotValue: 2 };
    case '3pt': return { kind: 'fg', made: a.shotResult === 'Made', shotValue: 3 };
    case 'freethrow':
      return {
        kind: 'ft',
        made: a.shotResult === 'Made' ? true : a.shotResult === 'Missed' ? false : !missedFromText(a),
        shotValue: 1,
      };
    case 'rebound': return { kind: 'rebound', made: null, shotValue: null };
    case 'turnover': return { kind: 'turnover', made: null, shotValue: null };
    case 'steal': return { kind: 'steal', made: null, shotValue: null };
    case 'block': return { kind: 'block', made: null, shotValue: null };
    default: return OTHER;
  }
}

function classifyStats(a: RawAction): Classified {
  const three = a.shotValue === 3 || /\b3PT\b/i.test(a.description ?? '') ? 3 : 2;
  switch (a.actionType) {
    case 'Made Shot': return { kind: 'fg', made: true, shotValue: three };
    case 'Missed Shot': return { kind: 'fg', made: false, shotValue: three };
    case 'Free Throw': return { kind: 'ft', made: !missedFromText(a), shotValue: 1 };
    case 'Rebound': return { kind: 'rebound', made: null, shotValue: null };
    case 'Turnover': return { kind: 'turnover', made: null, shotValue: null };
    default: return OTHER;
  }
}

function parseScore(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** First and last NBA team ids — v3 team events (team rebounds, team turnovers) put the team id in personId. */
const FIRST_TEAM_ID = 1610612737;
const LAST_TEAM_ID = 1610612766;

/** A real player id, or null for missing/0 and team ids. */
function playerId(id: number | null | undefined): number | null {
  if (!id) return null;
  return id >= FIRST_TEAM_ID && id <= LAST_TEAM_ID ? null : id;
}

/** Normalizes a game's actions in provider order (both providers list them chronologically). */
export function normalizePbp(raw: RawPlayByPlay, source: PbpSource): NormalizedPbp {
  let home = 0;
  let away = 0;
  const events: PbpEvent[] = [];
  for (const a of raw.game.actions) {
    const nextHome = parseScore(a.scoreHome) ?? home;
    const nextAway = parseScore(a.scoreAway) ?? away;
    const clockSec = clockSeconds(a.clock);
    const cls = source === 'cdn' ? classifyCdn(a) : classifyStats(a);
    events.push({
      seq: events.length + 1,
      actionNumber: source === 'stats_pbp' ? a.actionId ?? a.actionNumber : a.actionNumber,
      actionType: a.actionType ?? '',
      subType: a.subType ?? '',
      period: a.period,
      clockSec,
      elapsedSec: elapsedSeconds(a.period, clockSec),
      teamTricode: a.teamTricode ? normalizeTricode(a.teamTricode) : null,
      personId: playerId(a.personId),
      ...cls,
      assistPersonId: source === 'cdn' ? playerId(a.assistPersonId) : null,
      points: nextHome - home + (nextAway - away),
      scoringSide: nextHome > home ? 'home' : nextAway > away ? 'away' : null,
      scoreHome: nextHome,
      scoreAway: nextAway,
      description: a.description ?? '',
    });
    home = nextHome;
    away = nextAway;
  }
  return { source, hasDefensiveCredits: source === 'cdn', events };
}
