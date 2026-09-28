// src/lib/types/live-state.ts
// The live runner's derived state for one game (Live v2 spec §4). Written by
// scripts/lib/live-poller.ts into live_state.state, read by /api/live.
// Zero runtime imports — importable by scripts/ and src/.

/** Where the game is, as far as polling cadence is concerned (spec §3). */
export type LivePhase = 'PREGAME' | 'TIP_WATCH' | 'LIVE' | 'CLUTCH' | 'STOPPAGE' | 'HALFTIME' | 'FINAL';
