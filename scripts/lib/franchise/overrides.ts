// scripts/lib/franchise/overrides.ts
// Facts we've written ourselves, applied after parsing on every import and job run (spec §3.2 "Overrides";
// applyOverrides in apply-overrides.ts says what each kind does).
//
// Every entry needs `source`: a one-line note of where the fact comes from, e.g.
//   source: 'Wikipedia 1986 draft notes; checked RealGM manually'
// Keep it small. An entry that stops matching anything is reported as stale: delete it then.
//
// Examples of each kind (apply-overrides.ts says which phase applies each, and what it does):
//   { kind: 'pick', match: { draftYear: 1978, overall: 60 }, set: { originalFranchiseId: 1610612738 }, source: '…' }
//   { kind: 'pick', match: { moveKey: 'bbref:1984-…', partIndex: 1 }, set: { year: 1986, round: 1, originalFranchiseId: 1610612748 }, source: '…' }
//   { kind: 'pick', match: { pickKey: '2028-1-LAC' }, set: { protections: [{ year: 0, range: '1-3', then: null }], protectionsText: 'Top-3 protected' }, source: '…' }
//   { kind: 'move', match: { moveKey: 'bbref:1981-…' }, replaceParts: [{ from: …, to: …, kind: 'other', text: 'compensation not recorded' }], complete: false, source: '…' }
//   { kind: 'move', match: { source: 'LAC-1982_transactions', text: '<the unparsed line>' }, create: { kind: 'trade' }, replaceParts: [ … ], source: '…' }
//   { kind: 'move', match: { moveKey: 'wiki:1978–79 San Diego Clippers season#4' }, mergeInto: 'bbref:1978-10-12:…', source: '…' }
//   { kind: 'move', match: { moveKey: 'wiki:…' }, drop: true, reason: 'the same trade as bbref:…, listed twice', source: '…' }
//   { kind: 'person', match: { ref: 'World Free', scope: { seasonId: 1978 } }, personKey: 'freewo01', source: '…' }
//   { kind: 'ignore', match: { source: 'LAC-1999_transactions', text: '<the unparsed line>' }, reason: 'not a roster move', source: '…' }
//   { kind: 'teamName', match: { text: 'Kansas City Kings', seasonId: 1974 }, franchise: 1610612758, source: '…' }
import type { Override } from './types.js';

export const OVERRIDES: Override[] = [];
