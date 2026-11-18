// scripts/lib/insights/engine/evidence.ts
// Evidence spec (spec §2.6) and entity refs per insight. Pure.
import type { EntityRef, Evidence, Frame } from '../../../../src/lib/insights/types';
import { seasonLabel } from '../../schedule-utils.js';
import { fmtDate } from './dates.js';
import type { EngineContext, Fact } from './types.js';

/** Game-level facts: a ladder of the company joined, else the league-night rank. */
export function gameStatEvidence(f: Fact, fr: Frame, seasonText: string): Evidence | null {
  if (fr.type === 'joins_company' && fr.proof_rows.length > 0) {
    return {
      type: 'history_ladder',
      current: { value: f.value, label: `${f.subject.name}, ${fmtDate(f.context.date)}` },
      others: fr.proof_rows.slice(0, 5).map((raw) => {
        const r = raw as Record<string, unknown>;
        return { value: Number(r.value), label: String(r.subject_name), date: fmtDate(String(r.game_date)) };
      }),
    };
  }
  const rank = fr.type === 'league_rank' ? fr.rank : f.data.rank;
  const total = fr.type === 'league_rank' ? fr.total : f.data.total;
  if (rank === undefined || total === undefined) return null;
  return { type: 'rank_track', rank, total, betterIsHigher: true, label: `NBA player games in ${seasonText}` };
}

export function buildEvidence(f: Fact, fr: Frame): Evidence | null {
  const d = f.data;
  const season = f.seasonId !== null ? seasonLabel(f.seasonId) : '';
  switch (f.kind) {
    case 'streak':
      return d.streak_games && d.streak_games.length > 0
        ? { type: 'streak_strip', games: d.streak_games, threshold: d.hit_threshold ?? 0 }
        : null;
    case 'milestone':
      return { type: 'milestone_progress', current: d.total_value ?? f.value, target: d.threshold ?? f.value, label: d.unit ?? '' };
    case 'league_rank':
    case 'recent_form':
    case 'opp_rank':
      return d.rank !== undefined && d.total !== undefined
        ? { type: 'rank_track', rank: d.rank, total: d.total, betterIsHigher: d.higherIsBetter ?? true, label: d.label ?? '' }
        : null;
    case 'standings':
      return d.rank !== undefined && d.total !== undefined
        ? { type: 'rank_track', rank: d.rank, total: d.total, betterIsHigher: true, label: `the ${d.conference ?? 'conference'}` }
        : null;
    case 'yoy_change':
      if (d.prev_value === undefined || d.cur_value === undefined || f.seasonId === null) return null;
      return {
        type: 'delta',
        before: { value: d.prev_value, label: seasonLabel(f.seasonId - 1) },
        after: { value: d.cur_value, label: season },
        betterIsHigher: d.higherIsBetter ?? true,
      };
    case 'league_night':
      return gameStatEvidence(f, fr, season);
    default:
      return null;
  }
}

export function buildEntities(f: Fact, ctx: EngineContext): EntityRef[] {
  const out: EntityRef[] = [];
  if (f.subject.type === 'player') out.push({ type: 'player', id: f.subject.id, name: f.subject.name });
  else out.push({ type: 'team', id: f.subject.id, name: ctx.teams.get(f.subject.id)?.fullName ?? f.subject.name });
  const opp = f.context.opponent_id;
  if (opp && opp !== f.subject.id) {
    out.push({ type: 'team', id: opp, name: ctx.teams.get(opp)?.fullName ?? f.context.opponent_name ?? opp });
  }
  if (f.gameId) {
    const short = opp ? ctx.teams.get(opp)?.name : undefined;
    out.push({ type: 'game', id: f.gameId, name: `${fmtDate(f.context.date)}${short ? ` vs ${short}` : ''}` });
  }
  return out;
}
