import { describe, expect, it } from 'vitest';
import { bbrefMoveKey, chooseTransactionKey, pickKey, personKey, swapKey, tradeSlug } from './keys.js';

describe('keys', () => {
  it('pickKey uses the current franchise tricode', () => {
    expect(pickKey(2022, 1, 1610612746)).toBe('2022-1-LAC');
  });
  it('pickKey refuses the year-0 / round-0 placeholders of a vague pick', () => {
    expect(() => pickKey(0, 2, 1610612746)).toThrow();
    expect(() => pickKey(2022, 0, 1610612746)).toThrow();
  });
  it('swapKey sorts the franchises', () => {
    expect(swapKey(2024, 1, 1610612747, 1610612746)).toBe(swapKey(2024, 1, 1610612746, 1610612747));
    expect(swapKey(2024, 1, 1610612747, 1610612746)).toBe('2024-1-LAC-LAL');
  });
  it('chooseTransactionKey prefers nba > bbref > wiki > espn', () => {
    expect(chooseTransactionKey(['wiki:x', 'bbref:y', 'nba:Trade 1'])).toBe('nba:Trade 1');
    expect(chooseTransactionKey(['espn:z', 'wiki:x'])).toBe('wiki:x');
  });
  it('tradeSlug is deterministic', () => {
    expect(tradeSlug('nba:Trade 1', '2019-07-10')).toMatch(/^2019-07-10-[0-9a-f]{6}$/);
    expect(tradeSlug('nba:Trade 1', '2019-07-10')).toBe(tradeSlug('nba:Trade 1', '2019-07-10'));
  });
  it('bbrefMoveKey sorts tokens', () => {
    expect(bbrefMoveKey('2004-07-29', 'trade', ['pick2005r2', 'kittlke01'])).toBe(
      'bbref:2004-07-29:trade:kittlke01|pick2005r2',
    );
  });
  it('personKey prefers bbref, then nba id, then name+draft year', () => {
    expect(personKey({ bbrefId: 'leonaka01', nbaPersonId: 1, name: 'Kawhi Leonard' })).toBe('leonaka01');
    expect(personKey({ nbaPersonId: 202695, name: 'Kawhi Leonard' })).toBe('nba:202695');
    expect(personKey({ name: "Shaquille O'Neal Jr." }, 1992)).toBe('name:shaquille-oneal-1992');
    expect(() => personKey({ name: 'Nobody' })).toThrow();
  });
});
