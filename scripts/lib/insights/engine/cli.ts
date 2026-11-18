// scripts/lib/insights/engine/cli.ts
// generate-insights flags (spec §5.1: --surface, --game, --as-of; plus --days
// for the postgame window and --dry). Pure.
import type { Surface } from '../../../../src/lib/insights/types';
import { isIsoDate } from './dates.js';

/** Surfaces generate-insights writes. Live insights come from the game-night runner (Plan 6). */
export const BATCH_SURFACES: Surface[] = ['season', 'pregame', 'postgame', 'player'];
export const DEFAULT_DAYS = 3;
const MAX_DAYS = 400;

export interface EngineArgs {
  surfaces: Surface[];
  gameId: string | null;
  asOf: string;
  write: boolean;
  verbose: boolean;
  /** Postgame window in days (finals dated (asOf − days, asOf]). */
  days: number;
}

export function parseEngineArgs(argv: string[], today: string): EngineArgs {
  const out: EngineArgs = { surfaces: [...BATCH_SURFACES], gameId: null, asOf: today, write: true, verbose: false, days: DEFAULT_DAYS };
  let daysGiven = false;
  for (const arg of argv) {
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const value = eq === -1 ? '' : arg.slice(eq + 1);
    switch (flag) {
      case '--surface': {
        const list = value.split(',').map((s) => s.trim()).filter(Boolean);
        if (list.length === 0) throw new Error(`--surface needs one or more of ${BATCH_SURFACES.join(', ')}`);
        for (const s of list) {
          if (s === 'live') throw new Error('live insights are written by the game-night runner, not generate-insights');
          if (!(BATCH_SURFACES as string[]).includes(s)) throw new Error(`unknown surface "${s}" (expected ${BATCH_SURFACES.join(', ')})`);
        }
        out.surfaces = [...new Set(list)] as Surface[];
        break;
      }
      case '--game':
        if (!/^\d+$/.test(value)) throw new Error(`--game must be a numeric game id, got "${value}"`);
        out.gameId = value;
        break;
      case '--as-of':
        if (!isIsoDate(value)) throw new Error(`--as-of must be YYYY-MM-DD, got "${value}"`);
        if (value > today) throw new Error(`--as-of ${value} is in the future`);
        out.asOf = value;
        break;
      case '--days': {
        const n = /^\d+$/.test(value) ? Number(value) : NaN;
        if (!(n >= 1 && n <= MAX_DAYS)) throw new Error(`--days must be a whole number from 1 to ${MAX_DAYS}, got "${value}"`);
        out.days = n;
        daysGiven = true;
        break;
      }
      case '--dry':
        out.write = false;
        break;
      case '--verbose':
        out.verbose = true;
        break;
      default:
        throw new Error(`unknown argument "${arg}"`);
    }
  }
  if (out.gameId !== null && (out.surfaces.length !== 1 || out.surfaces[0] !== 'postgame')) {
    throw new Error('--game needs --surface=postgame');
  }
  if (daysGiven && !out.surfaces.includes('postgame')) throw new Error('--days needs the postgame surface');
  if (daysGiven && out.gameId !== null) throw new Error('--days and --game are exclusive: --game replaces the window');
  return out;
}
