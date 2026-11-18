// scripts/lib/insights/engine/cli.ts
// generate-insights flags (spec §5.1: --surface, --game, --as-of). Pure.
import type { Surface } from '../../../../src/lib/insights/types';
import { isIsoDate } from './dates.js';

/** Surfaces generate-insights writes. Live insights come from the game-night runner (Plan 6). */
export const BATCH_SURFACES: Surface[] = ['season', 'pregame', 'postgame'];

export interface EngineArgs {
  surfaces: Surface[];
  gameId: string | null;
  asOf: string;
  write: boolean;
  verbose: boolean;
}

export function parseEngineArgs(argv: string[], today: string): EngineArgs {
  const out: EngineArgs = { surfaces: [...BATCH_SURFACES], gameId: null, asOf: today, write: true, verbose: false };
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
  return out;
}
