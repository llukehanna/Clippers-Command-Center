// One template module per fact kind (spec §2.5). Plan 3 adds the new kinds.
import type { FactKind } from '../types.js';
import { h2hTemplates } from './h2h.js';
import { gameFlowTemplates } from './game-flow.js';
import { lastMeetingTemplates } from './last-meeting.js';
import { leagueRankTemplates } from './league-rank.js';
import { milestoneCrossedTemplates } from './milestone-crossed.js';
import { milestoneTemplates } from './milestone.js';
import { oppRankTemplates } from './opp-rank.js';
import { clutchTemplates, playerPeriodTemplates, teamPeriodTemplates } from './period.js';
import { playerComboTemplates, playerLineTemplates } from './player-line.js';
import { recentFormTemplates } from './recent-form.js';
import type { TemplateModule } from './shared.js';
import { standingsTemplates } from './standings.js';
import { teamLineTemplates } from './team-line.js';
import { streakTemplates } from './streak.js';
import { yoyTemplates } from './yoy.js';

export const TEMPLATES: Record<FactKind, TemplateModule> = {
  streak: streakTemplates,
  milestone: milestoneTemplates,
  milestone_crossed: milestoneCrossedTemplates,
  league_rank: leagueRankTemplates,
  standings: standingsTemplates,
  recent_form: recentFormTemplates,
  yoy_change: yoyTemplates,
  opp_rank: oppRankTemplates,
  h2h: h2hTemplates,
  last_meeting: lastMeetingTemplates,
  player_game_stat: playerLineTemplates,
  player_combo: playerComboTemplates,
  team_game_stat: teamLineTemplates,
  game_flow: gameFlowTemplates,
  player_period_stat: playerPeriodTemplates,
  team_period_stat: teamPeriodTemplates,
  clutch: clutchTemplates,
};
