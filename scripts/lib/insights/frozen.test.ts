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
  it('a postgame row inside the window is not frozen (the nightly run re-emits it)', () => {
    expect(isFrozenPostgame({ surface: 'postgame', game_date: '2026-11-15', season_id: 2026 }, today)).toBe(false);
    expect(isFrozenPostgame({ surface: 'postgame', game_date: '2026-11-17', season_id: 2026 }, today)).toBe(false);
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
