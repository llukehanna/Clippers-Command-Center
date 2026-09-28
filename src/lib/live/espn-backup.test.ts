import { describe, it, expect } from 'vitest';
import { espnScoreboardUrl, overlayEspn, parseEspnScoreboard } from './espn-backup';
import type { LivePayload } from '../ui/types';

const event = (home: string, away: string, hs: string, as: string, state: string, period = 3, clock = '4:32', detail = '4:32 - 3rd', completed?: boolean) => ({
  competitions: [{
    competitors: [
      { homeAway: 'home', score: hs, team: { abbreviation: home } },
      { homeAway: 'away', score: as, team: { abbreviation: away } },
    ],
    status: { period, displayClock: clock, type: { state, shortDetail: detail, completed } },
  }],
});

describe('parseEspnScoreboard', () => {
  it('finds the game by NBA tricodes, mapping ESPN abbreviations', () => {
    const json = { events: [event('NY', 'BOS', '50', '48', 'in'), event('LAC', 'GS', '88', '85', 'in')] };
    expect(parseEspnScoreboard(json, 'LAC', 'GSW')).toEqual({
      home: 88, away: 85, period: 3, clock: '4:32', status: 'in_progress', status_text: '4:32 - 3rd',
    });
  });

  it('maps pre/post states and returns null when the game is missing or the payload is junk', () => {
    expect(parseEspnScoreboard({ events: [event('LAC', 'SAC', '110', '101', 'post', 4, '0.0', 'Final', true)] }, 'LAC', 'SAC')?.status).toBe('final');
    expect(parseEspnScoreboard({ events: [event('LAC', 'SAC', '0', '0', 'pre', 0, '0.0', '7:30 PM')] }, 'LAC', 'SAC')?.status).toBe('scheduled');
    expect(parseEspnScoreboard({ events: [] }, 'LAC', 'SAC')).toBeNull();
    expect(parseEspnScoreboard(null, 'LAC', 'SAC')).toBeNull();
  });

  it('returns null for postponed/cancelled games (post state without completed flag)', () => {
    expect(parseEspnScoreboard({ events: [event('LAC', 'SAC', '0', '0', 'post', 0, '0.0', 'Postponed', false)] }, 'LAC', 'SAC')).toBeNull();
  });
});

describe('espnScoreboardUrl', () => {
  it('asks for the game date explicitly (late games outlive ESPN\'s default day)', () => {
    expect(espnScoreboardUrl('2026-10-21')).toBe('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261021');
  });
});

describe('overlayEspn', () => {
  it('overlays score and clock, and labels the payload as the backup feed', () => {
    const p = {
      meta: { generated_at: '', source: 'mixed', stale: true, stale_reason: 'poll daemon offline', ttl_seconds: 5 },
      state: 'DATA_DELAYED',
      game: {
        game_id: '9', nba_game_id: '22600093', season_id: 2026, game_date: '2026-10-21', start_time_utc: null,
        status: 'in_progress', period: 2, clock: '1:00', status_text: 'Q2', periods: [],
        home: { team_id: '13', abbreviation: 'LAC', name: 'Clippers', score: 50, is_home: true },
        away: { team_id: '24', abbreviation: 'SAC', name: 'Kings', score: 48, is_home: false },
      },
      key_metrics: [], box_score: null, insights: [], other_games: [], odds: null,
    } as LivePayload;
    const out = overlayEspn(p, { home: 88, away: 85, period: 3, clock: '4:32', status: 'in_progress', status_text: '4:32 - 3rd' });
    expect(out.state).toBe('DATA_DELAYED');
    expect(out.meta.stale_reason).toBe('backup feed (ESPN)');
    expect(out.game).toMatchObject({ period: 3, clock: '4:32', status_text: '4:32 - 3rd', home: { score: 88 }, away: { score: 85 } });
  });

  it('returns payload unchanged when ESPN period is lower than payload period', () => {
    const p = {
      meta: { generated_at: '', source: 'mixed', stale: true, stale_reason: 'poll daemon offline', ttl_seconds: 5 },
      state: 'DATA_DELAYED',
      game: {
        game_id: '9', nba_game_id: '22600093', season_id: 2026, game_date: '2026-10-21', start_time_utc: null,
        status: 'in_progress', period: 3, clock: '2:30', status_text: 'Q3', periods: [],
        home: { team_id: '13', abbreviation: 'LAC', name: 'Clippers', score: 70, is_home: true },
        away: { team_id: '24', abbreviation: 'SAC', name: 'Kings', score: 65, is_home: false },
      },
      key_metrics: [], box_score: null, insights: [], other_games: [], odds: null,
    } as LivePayload;
    const out = overlayEspn(p, { home: 88, away: 85, period: 2, clock: '4:32', status: 'in_progress', status_text: '4:32 - 2nd' });
    expect(out).toBe(p);
  });

  it('returns payload unchanged when ESPN total score is lower than payload total score', () => {
    const p = {
      meta: { generated_at: '', source: 'mixed', stale: true, stale_reason: 'poll daemon offline', ttl_seconds: 5 },
      state: 'DATA_DELAYED',
      game: {
        game_id: '9', nba_game_id: '22600093', season_id: 2026, game_date: '2026-10-21', start_time_utc: null,
        status: 'in_progress', period: 2, clock: '1:00', status_text: 'Q2', periods: [],
        home: { team_id: '13', abbreviation: 'LAC', name: 'Clippers', score: 50, is_home: true },
        away: { team_id: '24', abbreviation: 'SAC', name: 'Kings', score: 48, is_home: false },
      },
      key_metrics: [], box_score: null, insights: [], other_games: [], odds: null,
    } as LivePayload;
    const out = overlayEspn(p, { home: 45, away: 40, period: 3, clock: '4:32', status: 'in_progress', status_text: '4:32 - 3rd' });
    expect(out).toBe(p);
  });

  it('overlays when ESPN period or score total is equal or ahead', () => {
    const p = {
      meta: { generated_at: '', source: 'mixed', stale: true, stale_reason: 'poll daemon offline', ttl_seconds: 5 },
      state: 'DATA_DELAYED',
      game: {
        game_id: '9', nba_game_id: '22600093', season_id: 2026, game_date: '2026-10-21', start_time_utc: null,
        status: 'in_progress', period: 2, clock: '1:00', status_text: 'Q2', periods: [],
        home: { team_id: '13', abbreviation: 'LAC', name: 'Clippers', score: 50, is_home: true },
        away: { team_id: '24', abbreviation: 'SAC', name: 'Kings', score: 48, is_home: false },
      },
      key_metrics: [], box_score: null, insights: [], other_games: [], odds: null,
    } as LivePayload;
    const out = overlayEspn(p, { home: 88, away: 85, period: 2, clock: '4:32', status: 'in_progress', status_text: '4:32 - Q2' });
    expect(out.game).toMatchObject({ period: 2, clock: '4:32', home: { score: 88 }, away: { score: 85 } });
  });
});
