import { describe, it, expect } from 'vitest';
import { overlayLiveDoc } from './payload';
import { box, liveDoc } from '../../../scripts/lib/live-fixtures';
import type { LivePayload } from '../ui/types';

function base(over: Partial<LivePayload> = {}): LivePayload {
  return {
    meta: { generated_at: '2026-10-22T02:40:00.000Z', source: 'mixed', stale: false, stale_reason: null, ttl_seconds: 5 },
    state: 'LIVE',
    game: {
      game_id: '9999', nba_game_id: '22600093', season_id: 2026, game_date: '2026-10-21',
      start_time_utc: '2026-10-22T02:30:00Z', status: 'in_progress', period: 1, clock: '10:00',
      status_text: 'Q1 10:00', periods: [],
      home: { team_id: '13', abbreviation: 'LAC', name: 'Clippers', score: 2, is_home: true },
      away: { team_id: '24', abbreviation: 'SAC', name: 'Kings', score: 0, is_home: false },
    },
    key_metrics: [], box_score: null, insights: [], other_games: [], odds: null,
    cadence: { phase: 'LIVE', next_ms: 3000 },
    ...over,
  };
}

describe('overlayLiveDoc', () => {
  it('returns the base unchanged when there is no game yet', () => {
    const b = base({ state: 'NO_ACTIVE_GAME', game: null });
    expect(overlayLiveDoc(b, liveDoc(5))).toBe(b);
  });

  it('lays the pushed score, clock, line score, cadence and other games over the base', () => {
    const doc = liveDoc(7, {
      home_score: 30, away_score: 28, period: 2, clock: '4:32', status_text: 'Q2 4:32',
      periods: [{ period: 1, home: 20, away: 15 }, { period: 2, home: 10, away: 13 }],
      other_games: [{ game_id: 'x' }], cadence: { phase: 'STOPPAGE', next_ms: 8000 },
      fetched_at: '2026-10-22T03:05:00.000Z',
    });
    const out = overlayLiveDoc(base(), doc);
    expect(out.state).toBe('LIVE');
    expect(out.snapshot_captured_at).toBe('2026-10-22T03:05:00.000Z');
    expect(out.game).toMatchObject({
      period: 2, clock: '4:32', status_text: 'Q2 4:32', periods: doc.periods,
      home: { abbreviation: 'LAC', name: 'Clippers', score: 30 }, away: { abbreviation: 'SAC', score: 28 },
    });
    expect(out.cadence).toEqual({ phase: 'STOPPAGE', next_ms: 8000 });
    expect(out.other_games).toEqual([{ game_id: 'x' }]);
    expect(out.odds).toBeNull();
  });

  it('builds the box score and key metrics with LAC on the correct side', () => {
    const b = box({ home: 30, away: 28 });
    const out = overlayLiveDoc(base(), liveDoc(8, { home_box: b.homeTeam, away_box: b.awayTeam }));
    expect(out.key_metrics.map((m) => m.key)).toEqual(['efg_pct', 'tov_margin', 'reb_margin', 'pace']);
    expect(out.box_score?.teams.map((t) => t.team_abbr)).toEqual(['LAC', 'SAC']);
  });

  it('regenerates live insights from the pushed state (clutch)', () => {
    const out = overlayLiveDoc(base(), liveDoc(9, { period: 4, clock: '3:00', home_score: 100, away_score: 98 }));
    expect(out.insights.some((i) => i.category === 'clutch')).toBe(true);
    expect(out.insights.every((i) => i.insight_id.startsWith('live-9999-'))).toBe(true);
  });
});
