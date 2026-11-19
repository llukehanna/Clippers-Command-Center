import { describe, it, expect } from 'vitest';
import { isFrozenPostgame } from './frozen';

const today = '2026-11-18';

describe('isFrozenPostgame', () => {
  it('a postgame row for a past-season game is frozen', () => {
    expect(isFrozenPostgame({ surface: 'postgame', game_date: '2026-03-01', season_id: 2025 }, today)).toBe(true);
  });
  it('a current-season postgame row older than the 3-day window is frozen', () => {
    expect(isFrozenPostgame({ surface: 'postgame', game_date: '2026-11-14', season_id: 2026 }, today)).toBe(true);
  });
  it('the window is (today - days, today]: today - 3 is frozen, today - 2 is still re-emitted', () => {
    expect(isFrozenPostgame({ surface: 'postgame', game_date: '2026-11-15', season_id: 2026 }, today)).toBe(true);
    expect(isFrozenPostgame({ surface: 'postgame', game_date: '2026-11-16', season_id: 2026 }, today)).toBe(false);
    expect(isFrozenPostgame({ surface: 'postgame', game_date: '2026-11-17', season_id: 2026 }, today)).toBe(false);
  });
  it('honours a wider window (backfill days=30)', () => {
    expect(isFrozenPostgame({ surface: 'postgame', game_date: '2026-11-10', season_id: 2026 }, today, 30)).toBe(false);
    expect(isFrozenPostgame({ surface: 'postgame', game_date: '2026-10-19', season_id: 2026 }, today, 30)).toBe(true);
  });
  it('other surfaces are never frozen, however old', () => {
    for (const surface of ['season', 'pregame', 'player', null]) {
      expect(isFrozenPostgame({ surface, game_date: '2020-01-01', season_id: 2019 }, today)).toBe(false);
    }
  });
  it('a postgame row with no game is not frozen', () => {
    expect(isFrozenPostgame({ surface: 'postgame', game_date: null, season_id: null }, today)).toBe(false);
  });
});
