import { describe, it, expect } from 'vitest';
// Stub — filled in Plan 02 when generateLiveInsights is implemented
// import { generateLiveInsights } from './live.js';

describe('generateLiveInsights', () => {
  it.todo('returns an array of InsightRow objects');
  it.todo('generates a run insight when team scores 8+ unanswered points');
  it.todo('generates a milestone insight when player reaches scoring milestone');
  it.todo('deduplicates via proof_hash (no duplicate headlines for same proof)');
  it.todo('returns empty array when no qualifying conditions met');
});
