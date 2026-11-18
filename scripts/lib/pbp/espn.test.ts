import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('../espn-live-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../espn-live-client.js')>()),
  fetchEspnScoreboard: vi.fn(),
  fetchEspnSummary: vi.fn(),
}));

import { fetchEspnScoreboard, fetchEspnSummary, type EspnSummaryJson, type PersonIdResolver } from '../espn-live-client.js';
import { espnToRaw, fetchEspnPbp } from './espn';
import { normalizePbp } from './normalize';
import { derivePeriodStats } from './derive';

// CHA @ LAC, Nov 15 2026 (ESPN 401909987), final 113-105; trimmed to the fields we read.
const GAME = JSON.parse(
  fs.readFileSync(path.join(__dirname, '__fixtures__', 'espn-401909987.json'), 'utf8')
) as EspnSummaryJson;

/** Every ESPN athlete resolves to 1_000_000 + its ESPN id, so the test can map back. */
const resolveAll: PersonIdResolver = (espnId) => 1_000_000 + Number(espnId);

describe('espnToRaw', () => {
  const raw = espnToRaw(GAME, '0022600211', resolveAll);
  const pbp = normalizePbp(raw, 'espn');
  const last = pbp.events[pbp.events.length - 1];

  it('ends at the final score, with unique action numbers', () => {
    expect([last.scoreHome, last.scoreAway]).toEqual([113, 105]);
    expect(new Set(pbp.events.map((e) => e.actionNumber)).size).toBe(pbp.events.length);
    expect(raw.game.gameId).toBe('0022600211');
  });

  it('period team points sum to the final score', () => {
    const { teams } = derivePeriodStats(pbp, { home: 'LAC', away: 'CHA' });
    const sum = (t: string) => teams.filter((l) => l.tricode === t).reduce((s, l) => s + l.pts, 0);
    expect([sum('LAC'), sum('CHA')]).toEqual([113, 105]);
  });

  it('keeps shot locations for field goals only, dropping ESPN sentinel values', () => {
    const fgs = pbp.events.filter((e) => e.kind === 'fg');
    const located = fgs.filter((e) => e.shotX !== null && e.shotY !== null);
    expect(located.length / fgs.length).toBeGreaterThan(0.9);
    for (const e of located) {
      expect(e.shotX).toBeGreaterThanOrEqual(0);
      expect(e.shotX).toBeLessThanOrEqual(50);
      expect(e.shotY).toBeGreaterThanOrEqual(0);
      expect(e.shotY).toBeLessThanOrEqual(94);
    }
    expect(pbp.events.filter((e) => e.kind !== 'fg' && (e.shotX !== null || e.shotY !== null))).toEqual([]);
  });

  it('credits assists, steals and blocks to the second participant', () => {
    expect(pbp.hasDefensiveCredits).toBe(true);
    // "Darius Garland makes 14-foot pullup jump shot (Brook Lopez assists)"
    const garland = pbp.events.find((e) => e.description.startsWith('Darius Garland makes 14-foot pullup'))!;
    expect(garland.assistPersonId).not.toBeNull();
    expect(garland.assistPersonId).not.toBe(garland.personId);

    // "Naz Reid lost ball turnover (Kris Dunn steals)": the steal follows, credited to LAC.
    const i = pbp.events.findIndex((e) => e.description === 'Naz Reid lost ball turnover (Kris Dunn steals)');
    expect(pbp.events[i].kind).toBe('turnover');
    expect(pbp.events[i + 1]).toMatchObject({ kind: 'steal', teamTricode: 'LAC', points: 0 });
    expect(pbp.events[i + 1].personId).not.toBe(pbp.events[i].personId);

    // "Isaiah Jackson blocks Naz Reid 's 8-foot ...": the block follows the miss, credited to the blocker's team.
    const j = pbp.events.findIndex((e) => e.description.startsWith('Isaiah Jackson blocks Naz Reid'));
    expect(pbp.events[j]).toMatchObject({ kind: 'fg', made: false });
    expect(pbp.events[j + 1].kind).toBe('block');
    expect(pbp.events[j + 1].teamTricode).not.toBe(pbp.events[j].teamTricode);

    const steals = pbp.events.filter((e) => e.kind === 'steal').length;
    const stealTexts = GAME.plays!.filter((p) => /\bsteals\)/.test(p.text ?? '')).length;
    expect(steals).toBe(stealTexts);
  });

  it('passes unmatched players through as negative ids', () => {
    const none: PersonIdResolver = (espnId) => -Number(espnId);
    const p = normalizePbp(espnToRaw(GAME, '0022600211', none), 'espn');
    expect(p.events.filter((e) => e.personId !== null).every((e) => e.personId! < 0)).toBe(true);
  });
});

describe('fetchEspnPbp', () => {
  beforeEach(() => {
    vi.mocked(fetchEspnScoreboard).mockReset();
    vi.mocked(fetchEspnSummary).mockReset();
  });

  const scoreboard = (home: string, away: string) => ({
    events: [{
      id: '401909987',
      competitions: [{
        status: { type: { state: 'post', completed: true } },
        competitors: [
          { homeAway: 'home', team: { abbreviation: home } },
          { homeAway: 'away', team: { abbreviation: away } },
        ],
      }],
    }],
  });
  const game = { nbaGameId: '0022600211', gameDate: '2026-11-15', homeTricode: 'LAC', awayTricode: 'CHA' };

  it("finds our game on ESPN's scoreboard for its date and converts its play-by-play", async () => {
    vi.mocked(fetchEspnScoreboard).mockResolvedValue(scoreboard('LAC', 'CHA'));
    vi.mocked(fetchEspnSummary).mockResolvedValue(GAME);
    const raw = await fetchEspnPbp(game, resolveAll);
    expect(fetchEspnScoreboard).toHaveBeenCalledWith('2026-11-15');
    expect(fetchEspnSummary).toHaveBeenCalledWith('401909987');
    expect(raw?.game.actions.length).toBeGreaterThan(400);
  });

  it('returns null when ESPN has no such game that day', async () => {
    vi.mocked(fetchEspnScoreboard).mockResolvedValue(scoreboard('LAL', 'CHA'));
    expect(await fetchEspnPbp(game, resolveAll)).toBeNull();
    expect(fetchEspnSummary).not.toHaveBeenCalled();
  });
});
