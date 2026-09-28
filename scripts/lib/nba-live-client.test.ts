import { describe, it, expect, afterEach, vi } from 'vitest';
import { parseNBAClock, clockToSecondsRemaining, nbaGetConditional, parseFreshness, NbaHttpError } from './nba-live-client.js';

describe('parseNBAClock', () => {
  it('converts ISO 8601 clock to MM:SS', () => {
    expect(parseNBAClock('PT04M32.00S')).toBe('4:32');
  });

  it('converts clock at exactly 0:00', () => {
    expect(parseNBAClock('PT00M00.00S')).toBe('0:00');
  });

  it('returns 0:00 for empty string (game not in progress)', () => {
    expect(parseNBAClock('')).toBe('0:00');
  });

  it('converts double-digit minutes', () => {
    expect(parseNBAClock('PT12M00.00S')).toBe('12:00');
  });

  it('handles single-digit minute with zero-padded seconds', () => {
    expect(parseNBAClock('PT1M05.00S')).toBe('1:05');
  });
});

describe('clockToSecondsRemaining', () => {
  it('converts ISO 8601 clock to total seconds remaining', () => {
    expect(clockToSecondsRemaining('PT04M32.00S')).toBe(272);
  });

  it('returns 0 for zero clock', () => {
    expect(clockToSecondsRemaining('PT00M00.00S')).toBe(0);
  });

  it('returns 0 for empty string (game not in progress)', () => {
    expect(clockToSecondsRemaining('')).toBe(0);
  });

  it('converts 12 minutes to 720 seconds', () => {
    expect(clockToSecondsRemaining('PT12M00.00S')).toBe(720);
  });
});

describe('parseFreshness', () => {
  it('reads max-age and Age in milliseconds', () => {
    expect(parseFreshness(new Headers({ 'cache-control': 'public, max-age=5', age: '2' }))).toEqual({ maxAgeMs: 5000, ageMs: 2000 });
  });

  it('ignores s-maxage and tolerates missing headers', () => {
    expect(parseFreshness(new Headers({ 'cache-control': 's-maxage=30' }))).toEqual({ maxAgeMs: null, ageMs: 0 });
    expect(parseFreshness(new Headers())).toEqual({ maxAgeMs: null, ageMs: 0 });
  });
});

describe('nbaGetConditional', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the body, validators and freshness on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { etag: '"abc"', 'cache-control': 'max-age=3' } })
    ));
    const r = await nbaGetConditional<{ ok: number }>('/x.json');
    expect(r.status).toBe(200);
    if (r.status === 200) expect(r.body).toEqual({ ok: 1 });
    expect(r.validators.etag).toBe('"abc"');
    expect(r.freshness.maxAgeMs).toBe(3000);
  });

  it('sends If-None-Match and reports 304 with the previous validators kept', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['If-None-Match']).toBe('"abc"');
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await nbaGetConditional('/x.json', { etag: '"abc"', lastModified: null });
    expect(r.status).toBe(304);
    expect(r.validators.etag).toBe('"abc"');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws NbaHttpError carrying the status on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    await expect(nbaGetConditional('/x.json')).rejects.toBeInstanceOf(NbaHttpError);
    await expect(nbaGetConditional('/x.json')).rejects.toMatchObject({ status: 403 });
  });
});
