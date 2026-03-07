// scripts/lib/odds-client.ts
// TheOddsApiAdapter — HTTP client implementing OddsAdapter interface.
// Fetches all NBA odds in a single bulk call from The Odds API v4.
// Swapping providers: instantiate a different adapter class in sync-odds.ts.

import type { OddsAdapter, OddsEvent, OddsSnapshot } from '../../src/lib/types/odds.js';

const ODDS_API_BASE = 'https://api.the-odds-api.com';
const REQUEST_TIMEOUT_MS = 30_000;

// ── Internal API response type (not exported) ─────────────────────────────────

interface OddsApiOutcome {
  name:   string;   // team name, "Over", or "Under"
  price:  number;   // american odds e.g. -110
  point?: number;   // spread value or total line
}

interface OddsApiMarket {
  key:      string;             // "h2h" | "spreads" | "totals"
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  key:         string;
  title:       string;
  last_update: string;
  markets:     OddsApiMarket[];
}

interface OddsApiEvent {
  id:            string;   // provider event ID
  commence_time: string;   // ISO 8601
  home_team:     string;   // "Los Angeles Clippers"
  away_team:     string;
  bookmakers:    OddsApiBookmaker[];
}

// ── HTTP helper (mirrors nbaGet pattern) ──────────────────────────────────────

async function oddsGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${ODDS_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) throw new Error(`Odds API ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`TIMEOUT after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ── TheOddsApiAdapter ─────────────────────────────────────────────────────────

export class TheOddsApiAdapter implements OddsAdapter {
  readonly providerKey = 'the-odds-api';

  private readonly apiKey: string;

  constructor() {
    const key = process.env.ODDS_API_KEY;
    if (!key) {
      throw new Error('TheOddsApiAdapter: ODDS_API_KEY environment variable is not set');
    }
    this.apiKey = key;
  }

  async fetchNBAOdds(): Promise<OddsEvent[]> {
    const raw = await oddsGet<OddsApiEvent[]>(
      '/v4/sports/basketball_nba/odds/',
      {
        apiKey:      this.apiKey,
        regions:     'us',
        markets:     'h2h,spreads,totals',
        oddsFormat:  'american',
      }
    );
    return raw.map(event => this.parseEvent(event));
  }

  private parseEvent(event: OddsApiEvent): OddsEvent {
    // Pick the first bookmaker that has all three markets; fall back to first bookmaker.
    const hasAllMarkets = (bm: OddsApiBookmaker) =>
      ['h2h', 'spreads', 'totals'].every(key =>
        bm.markets.some(m => m.key === key)
      );

    const bookmaker =
      event.bookmakers.find(hasAllMarkets) ?? event.bookmakers[0];

    const getMarket = (key: string) =>
      bookmaker?.markets.find(m => m.key === key);

    const h2h     = getMarket('h2h');
    const spreads = getMarket('spreads');
    const totals  = getMarket('totals');

    // moneyline: h2h outcomes matched by team name
    const moneyline_home =
      h2h?.outcomes.find(o => o.name === event.home_team)?.price ?? null;
    const moneyline_away =
      h2h?.outcomes.find(o => o.name === event.away_team)?.price ?? null;

    // spread: outcomes matched by team name, point is the spread value
    const spread_home =
      spreads?.outcomes.find(o => o.name === event.home_team)?.point ?? null;
    const spread_away =
      spreads?.outcomes.find(o => o.name === event.away_team)?.point ?? null;

    // total: "Over" outcome carries the total line
    const total_points =
      totals?.outcomes.find(o => o.name === 'Over')?.point ?? null;

    const snapshot: Omit<OddsSnapshot, 'captured_at'> = {
      moneyline_home,
      moneyline_away,
      spread_home,
      spread_away,
      total_points,
    };

    if (bookmaker) {
      console.log(`[${event.home_team} vs ${event.away_team}] using bookmaker: ${bookmaker.title}`);
    }

    return {
      provider_event_id: event.id,
      commence_time:     event.commence_time,
      home_team:         event.home_team,
      away_team:         event.away_team,
      snapshot,
    };
  }
}
