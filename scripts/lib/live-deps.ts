// scripts/lib/live-deps.ts
// Real I/O for the live poller: NBA CDN fetchers and the live_state store.

import type { Sql } from 'postgres';
import {
  fetchBoxscore,
  fetchBoxscoreConditional,
  fetchPlayByPlayConditional,
  fetchScoreboard,
  NbaHttpError,
} from './nba-live-client.js';
import type { PollerDeps } from './live-poller.js';
import { saveLiveMoment, saveLiveState } from './live-store.js';

export function nbaPollerDeps(sql: Sql, gameDbId: string): PollerDeps {
  return {
    fetchScoreboard,
    fetchPbp: fetchPlayByPlayConditional,
    async fetchBox(gameId, prev) {
      try {
        return await fetchBoxscoreConditional(gameId, prev);
      } catch (err) {
        // Same fallback as before Live v2: stats.nba.com when the CDN refuses us.
        if (err instanceof NbaHttpError && err.status === 403) {
          const body = await fetchBoxscore(gameId, gameId);
          return { status: 200, body, validators: {}, freshness: { maxAgeMs: null, ageMs: 0 } };
        }
        throw err;
      }
    },
    saveState: async (doc) => {
      await saveLiveState(sql, gameDbId, doc);
    },
    saveMoment: (doc, reason) => saveLiveMoment(sql, gameDbId, doc, reason),
    now: Date.now,
    log: (msg) => console.log(`[live] ${msg}`),
  };
}
