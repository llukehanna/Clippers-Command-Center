import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { collectCounterparties } from './counterparties.js';
import type { ParsedMove } from './types.js';

const { LAC, BOS, SAC, NYK } = NBA_TEAM_IDS;

const trade = (date: string, from: number, to: number, name: string): ParsedMove => ({
  sourceKey: `bbref:${date}`, date, kind: 'trade', involvesClippers: true, complete: true,
  parts: [{ from, to, kind: 'player', person: { name } }],
});

/** A one-trade Trades section between two teams. */
const page = (date: string, a: string, b: string, name: string) => [
  '===Trades===', '{|', '|-', `| ${date}`, `| To '''[[${a}]]'''<hr>Cash considerations`, `| To '''[[${b}]]'''<hr>[[${name}]]`, '|}',
].join('\n');

describe('collectCounterparties', () => {
  it('lists the receiving team\'s pages for the arrival season and the next two, never from 2015-16 on', () => {
    const r = collectCounterparties([trade('1978-10-12', LAC, BOS, 'Freeman Williams'), trade('2014-02-20', LAC, NYK, 'X Y')], () => null);
    expect(r.pages).toEqual([
      '1978–79 Boston Celtics season', '1979–80 Boston Celtics season', '1980–81 Boston Celtics season',
      '2013–14 New York Knicks season', '2014–15 New York Knicks season',
    ]);
    expect(r.read).toBe(0);
    // Trades from 2015-16 on are left to NBA.com's league rows; assets coming to the Clippers need no pages.
    expect(collectCounterparties([trade('2016-01-01', LAC, BOS, 'A B'), trade('1980-01-01', BOS, LAC, 'C D')], () => null).pages).toEqual([]);
  });

  it('follows a cached page to the next holder (step 2) and returns its trades as league rows', () => {
    const cached: Record<string, string> = {
      '1979–80 Boston Celtics season': page('January 5, 1980', 'Boston Celtics', 'Kansas City Kings', 'Freeman Williams'),
    };
    const r = collectCounterparties([trade('1978-10-12', LAC, BOS, 'Freeman Williams')], (t) => cached[t] ?? null);
    expect(r.pages).toContain('1979–80 Kansas City Kings season');
    expect(r.pages).toContain('1981–82 Kansas City Kings season');
    expect(r.read).toBe(1);
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0]).toMatchObject({ involvesClippers: false, date: '1980-01-05' });
    expect(r.moves[0].parts).toContainEqual({ from: BOS, to: SAC, kind: 'player', person: { name: 'Freeman Williams' } });
  });

  it('returns an unreadable trade on a cached page as unparsed (the import lists it in treeUnparsed)', () => {
    const bad = ['===Trades===', '{|', '|-', '| January 5, 1980', "| To '''[[Boston Celtics]]'''<hr>[[Freeman Williams]]", '|}'].join('\n');
    const r = collectCounterparties([trade('1978-10-12', LAC, BOS, 'Freeman Williams')], (t) => (t === '1979–80 Boston Celtics season' ? bad : null));
    expect(r.moves).toEqual([]);
    expect(r.unparsed).toHaveLength(1);
    expect(r.unparsed[0]).toMatchObject({ source: '1979–80 Boston Celtics season', date: '1980-01-05' });
  });
});
