import { describe, it, expect } from 'vitest';
import { currentHolder, mentionsPick, pickMention } from './pick-holder';

const LAC = 1610612746;
const PHI = 1610612755;
const BKN = 1610612751;

describe('currentHolder', () => {
  it('is the receiver of the latest linked part (by date, then transaction id)', () => {
    expect(currentHolder(LAC, [
      { from_franchise_id: PHI, to_franchise_id: BKN, date: '2025-02-01', transaction_id: '9' },
      { from_franchise_id: LAC, to_franchise_id: PHI, date: '2023-10-31', transaction_id: '20' },
    ])).toBe(BKN);
    expect(currentHolder(LAC, [
      { from_franchise_id: PHI, to_franchise_id: BKN, date: '2025-02-01', transaction_id: '12' },
      { from_franchise_id: BKN, to_franchise_id: LAC, date: '2025-02-01', transaction_id: '13' },
    ])).toBe(LAC);
  });

  it('is the original franchise when no part links the pick', () => {
    expect(currentHolder(LAC, [])).toBe(LAC);
  });

  it('is unknown (null) when the latest part has no receiver', () => {
    expect(currentHolder(LAC, [{ from_franchise_id: LAC, to_franchise_id: null, date: '2024-01-01', transaction_id: '1' }])).toBeNull();
  });

  it('never lets an undated part be the latest', () => {
    expect(currentHolder(LAC, [
      { from_franchise_id: LAC, to_franchise_id: PHI, date: '2023-10-31', transaction_id: '1' },
      { from_franchise_id: PHI, to_franchise_id: BKN, date: null, transaction_id: '2' },
    ])).toBe(PHI);
  });
});

describe('pickMention / mentionsPick', () => {
  it('reads year and round from source wording', () => {
    expect(pickMention('a 2027 second round draft pick')).toEqual({ years: [2027], round: 2 });
    expect(pickMention('2027 second-round pick')).toEqual({ years: [2027], round: 2 });
    expect(pickMention('1990 & 1992 first-round draft picks')).toEqual({ years: [1990, 1992], round: 1 });
    expect(pickMention('2025 2nd round pick')).toEqual({ years: [2025], round: 2 });
    expect(pickMention('a future second round draft pick')).toEqual({ years: [], round: 2 });
    expect(pickMention('draft consideration')).toEqual({ years: [], round: null });
    expect(pickMention(null)).toEqual({ years: [], round: null });
  });

  it('matches only the same year, and the same round when the text names one', () => {
    expect(mentionsPick('a 2029 second round draft pick', 2029, 2)).toBe(true);
    expect(mentionsPick('a 2029 second round draft pick', 2029, 1)).toBe(false);
    expect(mentionsPick('a 2028 second round draft pick', 2029, 2)).toBe(false);
    expect(mentionsPick('a 2029 draft pick', 2029, 1)).toBe(true);
    expect(mentionsPick('a future second round draft pick', 2029, 2)).toBe(false);
  });
});
