import { describe, it, expect } from 'vitest';
import {
  normalizePersonName,
  splitPersonName,
  pickUniqueNameMatch,
  type PlayerNameCandidate,
} from './player-match';

const c = (player_id: string, first: string, last: string, is_active = true): PlayerNameCandidate => ({
  player_id,
  first_name: first,
  last_name: last,
  display_name: `${first} ${last}`,
  is_active,
});

describe('normalizePersonName', () => {
  it('strips diacritics, punctuation and suffixes', () => {
    expect(normalizePersonName('Nikola Jokić')).toBe('nikola jokic');
    expect(normalizePersonName("De'Aaron Fox")).toBe('deaaron fox');
    expect(normalizePersonName('P.J. Tucker')).toBe('pj tucker');
    expect(normalizePersonName('Kelly Oubre Jr.')).toBe('kelly oubre');
    expect(normalizePersonName('Gary Trent Jr')).toBe('gary trent');
    expect(normalizePersonName('  Kawhi   Leonard ')).toBe('kawhi leonard');
    expect(normalizePersonName(null)).toBe('');
  });
});

describe('splitPersonName', () => {
  it('splits on the first space', () => {
    expect(splitPersonName('Kawhi Leonard')).toEqual({ firstName: 'Kawhi', lastName: 'Leonard' });
    expect(splitPersonName('Kelly Oubre Jr.')).toEqual({ firstName: 'Kelly', lastName: 'Oubre Jr.' });
    expect(splitPersonName('Nene')).toEqual({ firstName: 'Nene', lastName: '' });
    expect(splitPersonName('')).toEqual({ firstName: '', lastName: '' });
  });
});

describe('pickUniqueNameMatch', () => {
  it('matches across diacritics and suffixes', () => {
    const rows = [c('1', 'Nikola', 'Jokic'), c('2', 'Kelly', 'Oubre Jr.')];
    expect(pickUniqueNameMatch('Nikola Jokić', rows)?.player_id).toBe('1');
    expect(pickUniqueNameMatch('Kelly Oubre Jr.', rows)?.player_id).toBe('2');
  });

  it('returns null when there is no match', () => {
    expect(pickUniqueNameMatch('Someone Else', [c('1', 'Kawhi', 'Leonard')])).toBeNull();
    expect(pickUniqueNameMatch('', [c('1', 'Kawhi', 'Leonard')])).toBeNull();
  });

  it('prefers the sole active row among duplicates', () => {
    const rows = [c('1', 'Marcus', 'Morris', false), c('2', 'Marcus', 'Morris', true)];
    expect(pickUniqueNameMatch('Marcus Morris', rows)?.player_id).toBe('2');
  });

  it('refuses to guess between multiple active duplicates', () => {
    const rows = [c('1', 'Marcus', 'Morris'), c('2', 'Marcus', 'Morris')];
    expect(pickUniqueNameMatch('Marcus Morris', rows)).toBeNull();
  });
});
