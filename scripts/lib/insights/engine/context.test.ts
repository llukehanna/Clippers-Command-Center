import { describe, it, expect } from 'vitest';
import { assessLeagueCoverage, type TeamGames } from './coverage';
import { rosterSubquery } from './sql';

const league = (games: (i: number) => number, last: (i: number) => string): TeamGames[] =>
  Array.from({ length: 30 }, (_, i) => ({ team_id: String(i + 1), games: games(i), last_date: last(i) }));

describe('assessLeagueCoverage', () => {
  it('passes a complete league', () => {
    expect(assessLeagueCoverage(league((i) => 12 + (i % 3), () => '2026-11-16'), '1', '2026-11-16')).toEqual({ complete: true, reason: null });
  });
  it('fails when teams are missing', () => {
    expect(assessLeagueCoverage(league(() => 10, () => '2026-11-16').slice(0, 29), '1', '2026-11-16'))
      .toEqual({ complete: false, reason: '29 of 30 teams have box scores' });
  });
  it('fails when league box scores stopped while the Clippers kept going', () => {
    const rows = league((i) => (i === 0 ? 13 : 4), (i) => (i === 0 ? '2026-11-16' : '2026-10-27'));
    expect(assessLeagueCoverage(rows, '1', '2026-10-27')).toEqual({ complete: false, reason: 'games played range 4–13' });
  });
  it('fails when the league is stale even with an even spread', () => {
    const rows = league(() => 6, (i) => (i === 0 ? '2026-11-16' : '2026-11-01'));
    expect(assessLeagueCoverage(rows, '1', '2026-11-01')).toEqual({ complete: false, reason: 'league box scores end 2026-11-01, Clippers 2026-11-16' });
  });
  it('fails when an opponent row carries the Clippers date but the newest non-Clippers game is stale', () => {
    // Real data: the Clippers' latest opponent has box scores dated like the Clippers' own last game.
    const rows = league(() => 6, (i) => (i <= 1 ? '2026-11-16' : '2026-11-01'));
    expect(assessLeagueCoverage(rows, '1', '2026-11-10')).toEqual({ complete: false, reason: 'league box scores end 2026-11-10, Clippers 2026-11-16' });
  });
  it('fails when the Clippers row is missing', () => {
    const rows = league(() => 10, () => '2026-11-16').slice(1).concat([{ team_id: '31', games: 10, last_date: '2026-11-16' }]);
    expect(assessLeagueCoverage(rows, '1', '2026-11-16')).toEqual({ complete: false, reason: 'Clippers have no box scores' });
  });
  it('fails when no game without the Clippers has box scores', () => {
    expect(assessLeagueCoverage(league(() => 10, () => '2026-11-16'), '1', null).complete).toBe(false);
  });
});

describe('rosterSubquery', () => {
  it('bounds both roster checks by the as-of date', () => {
    const q = rosterSubquery('$1', '$2', '$4');
    expect(q).toContain('cg.season_id = $1::int AND cg.game_date <= $4::date');
    expect(q).toContain('tp.team_id = $2::bigint AND tg.game_date <= $4::date');
    expect(q).toContain('last_game.team_id = $2::bigint');
  });
});
