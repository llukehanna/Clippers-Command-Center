import { afterEach, describe, expect, it, vi } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import type { DbPlayer, PersonRow } from './people.js';
import { buildNightly, fetchFeed, NBA_TIMEOUT_MS, nextSyncedThrough } from './sync-moves.js';
import type { Override } from './types.js';

const { LAC, CLE } = NBA_TEAM_IDS;

const row = (type: string, date: string, desc: string, team: number, player: number, group: string) => ({
  Transaction_Type: type, TRANSACTION_DATE: `${date}T00:00:00`, TRANSACTION_DESCRIPTION: desc, TEAM_ID: team, PLAYER_ID: player, GroupSort: group,
});
const nbaFeed = (...rows: unknown[]) => ({ NBA_Player_Movement: { rows } });

const OLD = row('Signing', '2026-11-10', 'LA Clippers signed guard Old Hand to a contract.', LAC, 1, 'Signing 1');
const WESLEY = row('Signing', '2026-11-17', 'LA Clippers signed guard Blake Wesley to a 10-Day Contract.', LAC, 1631104, 'Signing 2');
const STRUS_IN = row('Trade', '2026-11-18', 'LA Clippers received guard Max Strus from Cleveland Cavaliers.', LAC, 1629622, 'Trade 2026020');
const CONSIDERATION = row('Trade', '2026-11-18', 'Cleveland Cavaliers received draft consideration from LA Clippers.', CLE, 0, 'Trade 2026020');
const ODD = row('Signing', '2026-11-18', 'LA Clippers and guard Blake Wesley agreed to terms.', LAC, 1631104, 'Signing 3');
const ODD_OLD = row('Signing', '2026-11-09', 'LA Clippers and guard Old Hand agreed to terms.', LAC, 1, 'Signing 0');

const players: DbPlayer[] = [
  { player_id: '10', nba_person_id: 1631104, display_name: 'Blake Wesley', birthdate: null },
  { player_id: '11', nba_person_id: 1629622, display_name: 'Max Strus', birthdate: null },
];
const people: PersonRow[] = [
  { personKey: 'strusma01', kind: 'player', displayName: 'Max Strus', birthdate: null, nbaPersonId: 1629622, playerId: '11' },
];

const nightly = (json: unknown, over: Partial<Parameters<typeof buildNightly>[0]> = {}) =>
  buildNightly({ source: 'nba', json, syncedThrough: '2026-11-10', people, players, overrides: [], currentDraftYear: 2027, ...over });

describe('buildNightly', () => {
  it('keeps only moves dated after the synced-through date', () => {
    const { data } = nightly(nbaFeed(OLD, WESLEY, STRUS_IN, CONSIDERATION));
    expect(data.moves.map((m) => m.transactionKey).sort()).toEqual(['nba:Signing 2:1631104', 'nba:Trade 2026020']);
    // With no synced-through date at all (an empty database), everything is new.
    expect(nightly(nbaFeed(OLD, WESLEY), { syncedThrough: null }).data.moves).toHaveLength(2);
  });

  it('gates only unparsed lines after the synced-through date, and an ignore override settles one', () => {
    expect(nightly(nbaFeed(ODD_OLD, WESLEY)).unparsed).toEqual([]);
    expect(nightly(nbaFeed(ODD, WESLEY)).unparsed.map((l) => l.text)).toEqual([ODD.TRANSACTION_DESCRIPTION]);
    const ignore: Override = { kind: 'ignore', match: { source: 'nba', text: ODD.TRANSACTION_DESCRIPTION }, reason: 'a report, not a move', source: 'test' };
    const settled = nightly(nbaFeed(ODD, WESLEY), { overrides: [ignore] });
    expect(settled.unparsed).toEqual([]);
    expect(settled.data.ignored.map((l) => l.text)).toEqual([ODD.TRANSACTION_DESCRIPTION]);
  });

  it('resolves an NBA.com id to the person_xref key already holding it, and adds nba: rows for the rest', () => {
    const { data } = nightly(nbaFeed(WESLEY, STRUS_IN, CONSIDERATION));
    const trade = data.moves.find((m) => m.kind === 'trade')!;
    expect(trade.parts.find((p) => p.kind === 'player')!.personKey).toBe('strusma01');
    // Only people person_xref lacks are written: Wesley as nba:<id>, with his Part 1 player.
    expect(data.people).toEqual([
      { personKey: 'nba:1631104', kind: 'player', displayName: 'Blake Wesley', birthdate: null, nbaPersonId: 1631104, playerId: '10' },
    ]);
  });

  it('keeps a draft consideration as an unidentified pick, so the move stays incomplete', () => {
    const trade = nightly(nbaFeed(STRUS_IN, CONSIDERATION)).data.moves[0];
    expect(trade.complete).toBe(false);
    expect(trade.parts.find((p) => p.kind === 'pick')).toMatchObject({ from: LAC, to: CLE, gap: 'pick_unidentified' });
  });

  it('reads ESPN prose, matching names to players for the NBA.com id', () => {
    const json = { transactions: [
      { date: '2026-11-18T08:00Z', description: 'Acquired G Max Strus from Cleveland.' },
      { date: '2026-11-01T07:00Z', description: 'Waived G Old Hand.' },
    ] };
    const { data, unparsed } = nightly(json, { source: 'espn' });
    expect(unparsed).toEqual([]);
    expect(data.moves).toHaveLength(1);
    const [m] = data.moves;
    expect(m.transactionKey).toMatch(/^espn:2026-11-18:/);
    expect(m.parts).toEqual([
      { from: CLE, to: LAC, kind: 'player', person: { name: 'Max Strus', nbaPersonId: 1629622 }, personKey: 'strusma01' },
    ]);
  });
});

describe('nextSyncedThrough', () => {
  it('advances to the latest date written, never backwards', () => {
    expect(nextSyncedThrough('2026-11-10', ['2026-11-12', '2026-11-11'])).toBe('2026-11-12');
    expect(nextSyncedThrough('2026-11-10', ['2026-11-08'])).toBe('2026-11-10');
  });
  it('stays put when nothing new was written', () => {
    expect(nextSyncedThrough('2026-11-10', [])).toBe('2026-11-10');
    expect(nextSyncedThrough(null, [])).toBeNull();
  });
});

describe('fetchFeed', () => {
  afterEach(() => { vi.useRealTimers(); });
  const espn = { transactions: [] };

  it('uses NBA.com when it answers', async () => {
    const fetchEspn = vi.fn(async () => espn);
    expect(await fetchFeed({ fetchNba: async () => nbaFeed(), fetchEspn })).toEqual({ source: 'nba', json: nbaFeed() });
    expect(fetchEspn).not.toHaveBeenCalled();
  });

  it('falls back to ESPN when NBA.com throws', async () => {
    const r = await fetchFeed({ fetchNba: async () => { throw new Error('HTTP 403'); }, fetchEspn: async () => espn });
    expect(r).toEqual({ source: 'espn', json: espn, nbaError: 'HTTP 403' });
  });

  it('falls back to ESPN when NBA.com takes 20 s', async () => {
    vi.useFakeTimers();
    expect(NBA_TIMEOUT_MS).toBe(20_000);
    let settled = false;
    const p = fetchFeed({ fetchNba: () => new Promise(() => {}), fetchEspn: async () => espn }).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ source: 'espn', json: espn, nbaError: 'NBA.com timed out after 20 s' });
  });

  it('throws when both sources fail', async () => {
    await expect(fetchFeed({
      fetchNba: async () => { throw new Error('HTTP 403'); }, fetchEspn: async () => { throw new Error('HTTP 500'); },
    })).rejects.toThrow(/NBA\.com: HTTP 403.*ESPN: HTTP 500/);
  });
});
