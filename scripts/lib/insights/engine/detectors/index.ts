// scripts/lib/insights/engine/detectors/index.ts
// Every detector the engine runs, by surface. Categories must be unique per
// surface: they define each detector's stale-row deactivation scope.
import type { Detector } from '../types.js';
import { flowDetector } from './postgame-flow.js';
import { clutchDetector, periodsDetector } from './postgame-periods.js';
import { playerLinesDetector } from './postgame-player-lines.js';
import { teamLinesDetector } from './postgame-team-lines.js';
import { matchupDetector } from './pregame-matchup.js';
import { opponentDetector } from './pregame-opponent.js';
import { milestonesCrossedDetector } from './postgame-milestones.js';
import { milestoneDetector } from './season-milestones.js';
import { leagueRankDetector, recentFormDetector, standingsDetector } from './season-ranks.js';
import { streakDetector } from './season-streaks.js';
import { yoyDetector } from './season-yoy.js';

export const DETECTORS: readonly Detector[] = [
  streakDetector('season'),
  milestoneDetector('season'),
  leagueRankDetector('season', { teams: true }),
  standingsDetector(),
  recentFormDetector(),
  yoyDetector('season'),
  opponentDetector(),
  matchupDetector(),
  playerLinesDetector(),
  teamLinesDetector(),
  flowDetector(),
  periodsDetector(),
  clutchDetector(),
  milestonesCrossedDetector(),
];
