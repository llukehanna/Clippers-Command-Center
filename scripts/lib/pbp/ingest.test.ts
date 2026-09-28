import { describe, it, expect, vi, beforeEach } from 'vitest';

// ingest.ts imports the DB singleton, which exits without DATABASE_URL; the
// provider clients are stubbed so no request leaves the machine.
vi.mock('../db.js', () => ({ sql: {} }));
vi.mock('../nba-live-client.js', () => ({ fetchPlayByPlay: vi.fn() }));
vi.mock('../stats-nba.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stats-nba.js')>()),
  fetchStatsPlayByPlay: vi.fn(),
}));

import { fetchPlayByPlay } from '../nba-live-client.js';
import { fetchStatsPlayByPlay } from '../stats-nba.js';
import { CDN_PBP_FIRST_SEASON, fetchNormalized } from './ingest';

const feed = {
  game: { gameId: '0022500001', actions: [
    { actionNumber: 1, clock: 'PT11M40.00S', period: 1, teamTricode: 'LAC', personId: 1, actionType: '2pt', shotResult: 'Made', scoreHome: '2', scoreAway: '0' },
  ] },
};

describe('fetchNormalized', () => {
  beforeEach(() => {
    vi.mocked(fetchPlayByPlay).mockReset();
    vi.mocked(fetchStatsPlayByPlay).mockReset();
  });

  it('uses the CDN for CDN-era seasons', async () => {
    vi.mocked(fetchPlayByPlay).mockResolvedValue(feed as never);
    const pbp = await fetchNormalized('0022500001', CDN_PBP_FIRST_SEASON, () => {});
    expect(pbp?.source).toBe('cdn');
    expect(fetchStatsPlayByPlay).not.toHaveBeenCalled();
  });

  it('returns null and logs when the CDN fails — never falls back to stats.nba.com', async () => {
    vi.mocked(fetchPlayByPlay).mockRejectedValue(new Error('HTTP 404'));
    const log = vi.fn();
    expect(await fetchNormalized('0022500001', 2025, log)).toBeNull();
    expect(fetchStatsPlayByPlay).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('HTTP 404'));
  });

  it('uses stats.nba.com for seasons before the CDN archive, or with no season', async () => {
    vi.mocked(fetchStatsPlayByPlay).mockResolvedValue(feed as never);
    expect((await fetchNormalized('0020500010', CDN_PBP_FIRST_SEASON - 1, () => {}))?.source).toBe('stats_pbp');
    expect((await fetchNormalized('0020500010', null, () => {}))?.source).toBe('stats_pbp');
    expect(fetchPlayByPlay).not.toHaveBeenCalled();
  });
});
