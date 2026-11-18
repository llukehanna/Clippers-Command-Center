import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { describeMove, eraTeamName } from './describe.js';
import type { MergedMove } from './reconcile-moves.js';
import type { MoveKind, MovePart } from './types.js';

const { LAC, CHA, OKC, BOS, UTA, SAC } = NBA_TEAM_IDS;

function mv(date: string, kind: MoveKind, parts: MovePart[]): MergedMove {
  return { sourceKey: 'k', date, kind, parts, involvesClippers: true, complete: true, sources: ['k'], transactionKey: 'k', conflicts: [] };
}
const PEOPLE: Record<string, string> = { elyme01: 'Melvin Ely', houseed01: 'Eddie House', martida01: 'Darrick Martin' };
const people = (k: string) => PEOPLE[k] ?? '';
const names = eraTeamName;

describe('describeMove', () => {
  it('describes a two-team trade with grouped picks', () => {
    const ely = mv('2004-07-14', 'trade', [
      { from: LAC, to: CHA, kind: 'player', person: { bbrefId: 'elyme01', name: 'Melvin Ely' } },
      { from: LAC, to: CHA, kind: 'player', person: { bbrefId: 'houseed01', name: 'Eddie House' } },
      { from: CHA, to: LAC, kind: 'pick', pick: { year: 2005, round: 2, selected: { name: 'Daniel Ewing' } }, pickKey: '2005-2-CHA' },
      { from: CHA, to: LAC, kind: 'pick', pick: { year: 2006, round: 2, selected: { name: 'Paul Davis' } }, pickKey: '2006-2-CHA' },
    ]);
    expect(describeMove(ely, names, people)).toBe('Traded Melvin Ely and Eddie House to the Charlotte Bobcats for 2005 and 2006 second-round picks');
  });

  it('uses the era name: to the Seattle SuperSonics in 1975', () => {
    const m = mv('1975-10-20', 'trade', [
      { from: LAC, to: OKC, kind: 'player', person: { bbrefId: 'x01', name: 'Joe Player' } },
      { from: OKC, to: LAC, kind: 'cash', text: '$100,000 cash' },
    ]);
    expect(describeMove(m, names, people)).toBe('Traded Joe Player to the Seattle SuperSonics for cash');
  });

  it('describes a 10-day signing', () => {
    const m = mv('1997-01-10', 'ten_day', [{ from: null, to: LAC, kind: 'player', person: { bbrefId: 'martida01', name: 'D. Martin' } }]);
    expect(describeMove(m, names, people)).toBe('Signed Darrick Martin to a 10-day contract');
  });

  it('uses an unlinked part\'s text', () => {
    const m = mv('1979-08-01', 'trade', [
      { from: LAC, to: BOS, kind: 'player', person: { name: 'Joe Player' } },
      { from: BOS, to: LAC, kind: 'pick', pick: { year: 0, round: 0, vague: true }, text: 'a future draft pick', gap: 'pick_unidentified' },
    ]);
    expect(describeMove(m, names, people)).toBe('Traded Joe Player to the Boston Celtics for a future draft pick');
  });

  it('describes a three-team trade from the Clippers side', () => {
    const m = mv('2010-02-01', 'trade', [
      { from: LAC, to: BOS, kind: 'player', person: { name: 'A One' } },
      { from: UTA, to: LAC, kind: 'pick', pick: { year: 2011, round: 1, originalFranchiseId: UTA } },
      { from: BOS, to: UTA, kind: 'cash' },
    ]);
    expect(describeMove(m, names, people)).toBe('Traded A One to the Boston Celtics, and acquired a 2011 first-round pick from the Utah Jazz, in a three-team trade');
  });

  it('names another team\'s pick with a possessive', () => {
    const m = mv('2021-08-07', 'trade', [
      { from: LAC, to: BOS, kind: 'pick', pick: { year: 2022, round: 2, originalFranchiseId: SAC } },
      { from: BOS, to: LAC, kind: 'player', person: { name: 'B Two' } },
    ]);
    expect(describeMove(m, names, people)).toBe('Traded the Sacramento Kings\' 2022 second-round pick to the Boston Celtics for B Two');
  });

  it('describes coach and waiver moves', () => {
    expect(describeMove(mv('2003-05-01', 'hire', [{ from: null, to: LAC, kind: 'other', person: { bbrefId: 'dunlemi01c', name: 'Mike Dunleavy' }, text: 'Head Coach' }]), names, () => ''))
      .toBe('Hired Mike Dunleavy as head coach');
    expect(describeMove(mv('2003-05-01', 'waiver', [{ from: LAC, to: null, kind: 'player', person: { name: 'Joe Player' } }]), names, () => ''))
      .toBe('Waived Joe Player');
  });

  it('names a non-Clippers move\'s team as the subject', () => {
    const m = { ...mv('2016-07-01', 'signing', [{ from: null, to: BOS, kind: 'player', person: { name: 'Al Horford' } }]), involvesClippers: false };
    expect(describeMove(m, names, () => '')).toBe('The Boston Celtics signed Al Horford');
  });
});
