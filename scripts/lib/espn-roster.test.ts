import { describe, it, expect } from 'vitest';
import { parseEspnRoster, isPlausibleRoster } from './espn-roster';

const athlete = (id: number, displayName: string, pos = 'G') => ({
  id: String(id), displayName, fullName: displayName,
  firstName: displayName.split(' ')[0], lastName: displayName.split(' ').slice(1).join(' '),
  jersey: String(id % 100), position: { abbreviation: pos, name: 'Guard' },
});

describe('parseEspnRoster', () => {
  it('reads the flat NBA shape', () => {
    const out = parseEspnRoster({ athletes: [athlete(1, 'Kawhi Leonard', 'F'), athlete(2, 'James Harden')] });
    expect(out).toEqual([
      { espn_id: '1', name: 'Kawhi Leonard', first_name: 'Kawhi', last_name: 'Leonard', position: 'F', jersey: '1',
        headshot_url: 'https://a.espncdn.com/i/headshots/nba/players/full/1.png' },
      { espn_id: '2', name: 'James Harden', first_name: 'James', last_name: 'Harden', position: 'G', jersey: '2',
        headshot_url: 'https://a.espncdn.com/i/headshots/nba/players/full/2.png' },
    ]);
  });

  it('reads the grouped shape and drops duplicates / junk', () => {
    const out = parseEspnRoster({
      athletes: [{ position: 'guards', items: [athlete(1, 'A B'), athlete(1, 'A B')] }, null, { id: 3 }],
    });
    expect(out.map((a) => a.name)).toEqual(['A B']);
  });

  it('prefers the headshot href ESPN sends', () => {
    const a = { ...athlete(7, 'Baba Miller'), headshot: { href: 'https://a.espncdn.com/x/7.png' } };
    expect(parseEspnRoster({ athletes: [a] })[0].headshot_url).toBe('https://a.espncdn.com/x/7.png');
  });

  it('returns [] for an unexpected body', () => {
    expect(parseEspnRoster({ error: 'nope' })).toEqual([]);
    expect(parseEspnRoster(null)).toEqual([]);
  });

  it('isPlausibleRoster rejects tiny or huge lists', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => athlete(i, `P ${i}`)).map((a) => parseEspnRoster({ athletes: [a] })[0]);
    expect(isPlausibleRoster(many(3))).toBe(false);
    expect(isPlausibleRoster(many(15))).toBe(true);
    expect(isPlausibleRoster(many(40))).toBe(false);
  });
});
