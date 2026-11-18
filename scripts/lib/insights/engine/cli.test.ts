import { describe, it, expect } from 'vitest';
import { parseEngineArgs } from './cli';

const TODAY = '2026-11-18';

describe('parseEngineArgs', () => {
  it('defaults to every batch surface as of today, writing', () => {
    expect(parseEngineArgs([], TODAY)).toEqual({
      surfaces: ['season', 'pregame', 'postgame'], gameId: null, asOf: TODAY, write: true, verbose: false,
    });
  });
  it('reads every flag', () => {
    expect(parseEngineArgs(['--surface=postgame', '--game=123', '--as-of=2026-02-25', '--dry', '--verbose'], TODAY))
      .toEqual({ surfaces: ['postgame'], gameId: '123', asOf: '2026-02-25', write: false, verbose: true });
    expect(parseEngineArgs(['--surface=season,pregame,season'], TODAY).surfaces).toEqual(['season', 'pregame']);
  });
  it('rejects bad input with a readable message', () => {
    expect(() => parseEngineArgs(['--surface=live'], TODAY)).toThrow(/game-night runner/);
    expect(() => parseEngineArgs(['--surface=bogus'], TODAY)).toThrow(/unknown surface "bogus"/);
    expect(() => parseEngineArgs(['--surface='], TODAY)).toThrow(/--surface needs/);
    expect(() => parseEngineArgs(['--game=12'], TODAY)).toThrow(/--game needs --surface=postgame/);
    expect(() => parseEngineArgs(['--surface=postgame', '--game=abc'], TODAY)).toThrow(/numeric/);
    expect(() => parseEngineArgs(['--as-of=2026-13-01'], TODAY)).toThrow(/YYYY-MM-DD/);
    expect(() => parseEngineArgs(['--as-of=2027-01-01'], TODAY)).toThrow(/future/);
    expect(() => parseEngineArgs(['--nope'], TODAY)).toThrow(/unknown argument "--nope"/);
  });
});
