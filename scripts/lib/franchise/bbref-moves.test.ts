import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { parseTransactionPage } from './bbref-moves.js';
import type { ParsedMove } from './types.js';

const fx = (n: string) =>
  readFileSync(new URL(`../__fixtures__/franchise/bbref/${n}`, import.meta.url), 'utf8');

const LAC = NBA_TEAM_IDS.LAC;
const CHA = NBA_TEAM_IDS.CHA;
const PHI = NBA_TEAM_IDS.PHI;
const ATL = NBA_TEAM_IDS.ATL;
const { BKN, CHI, DEN, DET, GSW, LAL, MIN, NYK, OKC, POR, SAC } = NBA_TEAM_IDS;

const fx2005 = fx('transactions-lac-2005.html');
const onDate = (moves: ParsedMove[], date: string) => moves.filter((m) => m.date === date);

describe('parseTransactionPage', () => {
  it('parses a two-for-two-picks trade', () => { // 2004-07-14 Ely/House to CHA
    const { moves } = parseTransactionPage(fx2005, 2004, '2005_transactions');
    const t = moves.find((m) => m.date === '2004-07-14')!;
    expect(t.kind).toBe('trade');
    expect(t.parts.filter((p) => p.from === LAC && p.kind === 'player').map((p) => p.person!.bbrefId)).toEqual(['elyme01', 'houseed01']);
    expect(t.parts.filter((p) => p.to === LAC && p.kind === 'pick').map((p) => [p.pick!.year, p.pick!.round, p.pick!.selected?.name]))
      .toEqual([[2005, 2, 'Daniel Ewing'], [2006, 2, 'Paul Davis']]);
    // the rest of the move
    expect(t.parts.every((p) => (p.from === LAC && p.to === CHA) || (p.from === CHA && p.to === LAC))).toBe(true);
    expect(t.parts.find((p) => p.kind === 'pick')!.pick!.selected).toEqual({ bbrefId: 'ewingda01', name: 'Daniel Ewing' });
    expect(t.involvesClippers).toBe(true);
    expect(t.complete).toBe(true);
    expect(t.sourceKey).toBe('bbref:2004-07-14:trade:elyme01|houseed01|pick2005r2|pick2006r2');
  });

  it('marks a vague future pick', () => { // 1970-11-26 Crawford trade
    const { moves, unparsed } = parseTransactionPage(fx('transactions-buf-1971.html'), 1970, '1971_transactions');
    expect(unparsed).toEqual([]);
    const t = moves.find((m) => m.date === '1970-11-26')!;
    expect(t.kind).toBe('trade');
    expect(t.parts).toHaveLength(2);
    expect(t.parts[0]).toMatchObject({ from: LAC, to: PHI, kind: 'player', person: { bbrefId: 'crawffr01', name: 'Freddie Crawford' } });
    const pick = t.parts[1];
    expect(pick).toMatchObject({ from: PHI, to: LAC, kind: 'pick', gap: 'pick_unidentified' });
    expect(pick.pick!.vague).toBe(true);
    expect(t.complete).toBe(false);
  });

  it('parses 10-day, two-way, waiver, claim, release and draft lines', () => {
    const { moves } = parseTransactionPage(fx2005, 2004, '2005_transactions');
    const tenDay = onDate(moves, '2005-01-05')[0];
    expect(tenDay.kind).toBe('ten_day');
    expect(tenDay.parts).toEqual([{ from: null, to: LAC, kind: 'player', person: { bbrefId: 'martida01', name: 'Darrick Martin' } }]);

    const waived = onDate(moves, '2004-10-28');
    expect(waived.map((m) => m.kind)).toEqual(['waiver', 'waiver']);
    expect(waived[0].parts).toEqual([{ from: LAC, to: null, kind: 'player', person: { bbrefId: 'dickeka01', name: 'Kaniel Dickens' } }]);

    const claim = onDate(moves, '2005-02-28')[0];
    expect(claim.kind).toBe('claim');
    expect(claim.parts).toEqual([{ from: ATL, to: LAC, kind: 'player', person: { bbrefId: 'anderke01', name: 'Kenny Anderson' } }]);

    const drafted = onDate(moves, '2005-06-28');
    expect(drafted.map((m) => [m.kind, m.parts[0].person!.bbrefId, m.parts[0].from, m.parts[0].to]))
      .toEqual([['draft', 'korolya01', null, LAC], ['draft', 'ewingda01', null, LAC]]);
    expect(drafted[0].sourceKey).toBe('bbref:2005-06-28:draft:korolya01');

    const twoWay = parseTransactionPage(fx('transactions-lac-2018.html'), 2017, '2018_transactions').moves
      .find((m) => m.kind === 'two_way')!;
    expect(twoWay.date).toBe('2017-07-18');
    expect(twoWay.parts).toEqual([{ from: null, to: LAC, kind: 'player', person: { bbrefId: 'wilsoja02', name: 'Jamil Wilson' } }]);

    const released = parseTransactionPage(fx('transactions-lac-1994.html'), 1993, '1994_transactions').moves
      .find((m) => m.kind === 'release')!;
    expect(released.date).toBe('1994-06-15');
    expect(released.parts).toEqual([{ from: LAC, to: null, kind: 'player', person: { bbrefId: 'willijo02', name: 'John Williams' } }]);
  });

  it('splits two items under one date into two moves', () => {
    const { moves } = parseTransactionPage(fx2005, 2004, '2005_transactions');
    const aug16 = onDate(moves, '2004-08-16');
    expect(aug16).toHaveLength(2);
    expect(aug16.map((m) => [m.kind, m.parts[0].person!.bbrefId])).toEqual([['signing', 'rossqu01'], ['signing', 'ndiayma02']]);
    expect(aug16[1].parts[0].person!.name).toBe("Mamadou N'Diaye");
    expect(aug16.map((m) => m.sourceKey)).toEqual(['bbref:2004-08-16:signing:rossqu01', 'bbref:2004-08-16:signing:ndiayma02']);
  });

  it('returns unmatched sentences as unparsed, never as moves', () => {
    const r = parseTransactionPage(fx('transactions-lac-2014.html'), 2013, '2014_transactions');
    expect(r.moves.filter((m) => m.date === '2014-02-14')).toEqual([]);
    expect(r.unparsed).toEqual([{
      source: '2014_transactions', index: 0, date: '2014-02-14',
      text: 'Did not re-sign Sasha Vujačić; 10-day contract expires.',
    }]);

    // a trade whose clause has blank team links (a BBRef data error) is unparsed as a whole
    const broken = parseTransactionPage(fx('transactions-lac-2027.html'), 2026, '2027_transactions');
    expect(broken.moves).toEqual([]);
    expect(broken.unparsed).toHaveLength(1);
    expect(broken.unparsed[0].text).toMatch(/^As part of a 5-team trade/);

    // a date with an unknown day cannot become a move
    const q = parseTransactionPage(fx('transactions-lac-1994.html'), 1993, '1994_transactions');
    expect(q.moves.map((m) => m.date)).toEqual(['1994-06-15']);
    expect(q.unparsed).toEqual([{ source: '1994_transactions', index: 0, date: null, text: 'Signed Bob Martin as a free agent.' }]);
  });

  // ---- rules added from the full-cache run (Step 5) -------------------------------------------------

  it('parses a multi-team trade clause by clause, including clauses between other teams', () => {
    const { moves } = parseTransactionPage(fx('transactions-lac-2018.html'), 2017, '2018_transactions');
    const t = moves.find((m) => m.parts.some((p) => p.person?.bbrefId === 'gallida01'))!;
    expect(t.kind).toBe('trade');
    expect(t.parts.map((p) => [p.from, p.to, p.kind, p.person?.bbrefId ?? p.pick?.selected?.bbrefId ?? p.text])).toEqual([
      [LAC, ATL, 'player', 'crawfja01'],
      [LAC, ATL, 'player', 'stonedi01'],
      [LAC, ATL, 'cash', '$1.3M'],
      [LAC, ATL, 'pick', 'spellom01'],
      [ATL, DEN, 'pick', 'martico01'],
      [DEN, LAC, 'player', 'gallida01'],
    ]);
  });

  it('reads cash amounts and ignores notes after the sentence', () => {
    const { moves } = parseTransactionPage(fx('transactions-lac-2018.html'), 2017, '2018_transactions');
    expect(moves.find((m) => m.date === '2017-07-06' && m.parts[0].kind === 'cash')!.parts).toEqual([
      { from: LAC, to: PHI, kind: 'cash', text: '$3.2M cash' },
      { from: PHI, to: LAC, kind: 'player', person: { bbrefId: 'evansja01', name: 'Jawun Evans' } },
    ]);
    // "... for a 2018 2nd round draft pick. 2018 2nd-rd pick did not convey"
    const t = onDate(moves, '2017-09-25')[0];
    expect(t.parts.map((p) => [p.from, p.to, p.kind, p.text ?? null])).toEqual([
      [LAC, ATL, 'player', null], [LAC, ATL, 'cash', '$100K cash'], [ATL, LAC, 'pick', null],
    ]);
    expect(t.parts[2].pick).toEqual({ year: 2018, round: 2 });
    expect(t.complete).toBe(true);
  });

  it('skips G League assignments and recalls, and reads the 2nd 10-day contract', () => {
    const r = parseTransactionPage(fx('transactions-lac-2018.html'), 2017, '2018_transactions');
    expect(r.unparsed).toEqual([]);
    expect(r.skipped.map((s) => [s.reason, s.text.split(' ')[0]])).toEqual([
      ['g_league', 'Assigned'], ['g_league', 'Assigned'], ['g_league', 'Recalled'],
    ]);
    expect(r.moves.some((m) => m.parts.some((p) => p.person?.bbrefId === 'evansja01' && m.kind !== 'trade'))).toBe(false);
    expect(r.moves.find((m) => m.date === '2018-03-14')).toMatchObject({ kind: 'ten_day', parts: [{ from: null, to: LAC, person: { bbrefId: 'kilpase01' } }] });
  });

  it('reads the other signing and 10-day wordings', () => {
    const y2021 = parseTransactionPage(fx('transactions-lac-2021.html'), 2020, '2021_transactions').moves;
    // "to an Exhibit 10 contract", bare "Signed X.", "to a multi-year contract"
    expect(onDate(y2021, '2020-11-27').map((m) => [m.kind, m.parts[0].person!.bbrefId])).toEqual([
      ['signing', 'fittsma01'], ['signing', 'fordjo01'], ['signing', 'oturuda01'],
    ]);
    expect(onDate(y2021, '2020-11-25').find((m) => m.parts[0].person!.bbrefId === 'pattepa01')!.kind).toBe('signing');

    const y1986 = parseTransactionPage(fx('transactions-lac-1986.html'), 1985, '1986_transactions').moves;
    expect(y1986.map((m) => [m.date, m.kind])).toEqual([
      ['1985-12-26', 'retirement'], ['1986-01-06', 'ten_day'], ['1986-01-31', 'ten_day'],
    ]);
    expect(y1986[0].parts).toEqual([{ from: LAC, to: null, kind: 'player', person: { bbrefId: 'wilkeja01', name: 'Jamaal Wilkes' } }]);

    const y2004 = parseTransactionPage(fx('transactions-lac-2004.html'), 2003, '2004_transactions').moves;
    expect(onDate(y2004, '2004-01-18')[0]).toMatchObject({ kind: 'ten_day', parts: [{ person: { bbrefId: 'barnema02' } }] });

    const y1991 = parseTransactionPage(fx('transactions-lac-1991.html'), 1990, '1991_transactions').moves;
    expect(y1991.map((m) => [m.kind, m.parts[0].from, m.parts[0].to, m.parts[0].person!.bbrefId])).toEqual([
      ['signing', null, LAC, 'butlegr01'], // "Signed X as an unrestricted free agent"
      ['signing', LAC, DEN, 'wolfjo01'], // "X signed as an unrestricted free agent with the Denver Nuggets"
    ]);

    const conv = parseTransactionPage(fx('transactions-lac-2022.html'), 2021, '2022_transactions').moves;
    expect(conv[0]).toMatchObject({ kind: 'conversion', parts: [{ from: null, to: LAC, person: { bbrefId: 'coffeam01' } }] });

    const vet = parseTransactionPage(fx('transactions-buf-1977.html'), 1976, '1977_transactions').moves;
    expect(onDate(vet, '1976-11-26')[0]).toMatchObject({ kind: 'signing', parts: [{ from: null, to: LAC, person: { bbrefId: 'abdulza01' } }] });
  });

  it('reads expansion-draft losses and draft-night trades with a team that starts next season', () => {
    const { moves, unparsed } = parseTransactionPage(fx('transactions-lac-2004.html'), 2003, '2004_transactions');
    expect(unparsed).toEqual([]);
    const [lost, trade] = onDate(moves, '2004-06-22');
    expect(lost).toMatchObject({ kind: 'expansion_draft', parts: [{ from: LAC, to: CHA, kind: 'player', person: { bbrefId: 'drobnpr01' } }] });
    // "... Charlotte also agreed to select Predrag Drobnjak in the expansion draft." is a note, not a part
    expect(trade.parts.map((p) => [p.from, p.to, p.pick!.year, p.pick!.round, p.pick!.selected!.bbrefId])).toEqual([
      [LAC, CHA, 2004, 1, 'okafoem01'], [CHA, LAC, 2004, 1, 'livinsh01'], [CHA, LAC, 2004, 2, 'chalmli01'],
    ]);
  });

  it('keeps an unlinked "was later selected" name without an id', () => {
    const { moves } = parseTransactionPage(fx('transactions-lac-2021.html'), 2020, '2021_transactions');
    const t = moves.find((m) => m.parts.some((p) => p.person?.bbrefId === 'lessoma01'))!;
    expect(t.parts).toEqual([
      { from: LAC, to: MIN, kind: 'player', person: { bbrefId: 'lessoma01', name: 'Mathias Lessort' } },
      { from: LAC, to: MIN, kind: 'pick', pick: { year: 2023, round: 2, selected: { name: 'James Nnaji' } } },
      { from: MIN, to: LAC, kind: 'player', person: { bbrefId: 'oturuda01', name: 'Daniel Oturu' } },
    ]);
  });

  it('reads player-rights sales and acquisitions', () => {
    const sold = parseTransactionPage(fx('transactions-buf-1977.html'), 1976, '1977_transactions').moves;
    expect(onDate(sold, '1976-09-10')[0]).toMatchObject({
      kind: 'sale', parts: [{ from: LAC, to: NYK, kind: 'draft_rights', person: { bbrefId: 'mcmilji01' } }],
    });
    const got = parseTransactionPage(fx('transactions-buf-1975.html'), 1974, '1975_transactions').moves;
    expect(got[0]).toMatchObject({
      date: '1974-08-29', kind: 'trade', parts: [{ from: ATL, to: LAC, kind: 'draft_rights', person: { bbrefId: 'schluda01' } }],
    });
  });

  it('marks a future pick with a known round as vague, keeping the round', () => {
    const { moves } = parseTransactionPage(fx('transactions-buf-1975.html'), 1974, '1975_transactions');
    const t = onDate(moves, '1974-09-04')[0];
    expect(t.complete).toBe(false);
    expect(t.parts.filter((p) => p.kind === 'pick').map((p) => [p.from, p.to, p.pick, p.gap ?? null])).toEqual([
      [LAC, CHI, { year: 1977, round: 2, selected: { bbrefId: 'johnsla01', name: 'Larry Johnson' } }, null],
      [LAC, CHI, { year: 0, round: 2, vague: true }, 'pick_unidentified'],
    ]);
    expect(t.sourceKey).toBe('bbref:1974-09-04:trade:guokama02|pick1977r2|pickfuturer2|weissbo01');
  });

  it('reads veteran free agent compensation both ways, and future considerations', () => {
    const y1978 = parseTransactionPage(fx('transactions-buf-1978.html'), 1977, '1978_transactions');
    const adams = y1978.moves.find((m) => m.parts[0].person?.bbrefId === 'adamsdo01')!;
    expect(adams.kind).toBe('signing');
    expect(adams.parts.map((p) => [p.from, p.to, p.kind])).toEqual([[LAC, DET, 'player'], [DET, LAC, 'pick']]);
    const bantom = y1978.moves.find((m) => m.kind === 'signing' && m.parts[0].person?.bbrefId === 'bantomi01')!;
    expect(bantom.parts.map((p) => [p.from, p.to, p.kind, p.gap ?? null])).toEqual([
      [null, LAC, 'player', null], [LAC, BKN, 'pick', 'pick_unidentified'],
    ]);
    expect(onDate(y1978.moves, '1977-09-07')[0].parts[1]).toEqual({ from: LAL, to: LAC, kind: 'other', text: 'future considerations' });

    const y1979 = parseTransactionPage(fx('transactions-sdc-1979.html'), 1978, '1979_transactions').moves;
    expect(y1979[0].parts.map((p) => [p.from, p.to, p.kind, p.person?.bbrefId ?? p.pick!.selected!.bbrefId])).toEqual([
      [LAC, GSW, 'player', 'abernto01'], [GSW, LAC, 'pick', 'garlaga01'],
    ]);
    expect(y1979[1].parts.map((p) => [p.from, p.to, p.kind])).toEqual([
      [null, LAC, 'player'], [LAC, POR, 'player'], [LAC, POR, 'player'], [LAC, POR, 'pick'],
    ]);
  });

  it('leaves compensation BBRef never filled in (FROM_TRADE) unparsed', () => {
    const r = parseTransactionPage(fx('transactions-buf-1978.html'), 1977, '1978_transactions');
    expect(r.unparsed.map((u) => [u.date, u.text])).toEqual([
      ['1978-06-12', 'Mike Glenn signed as a veteran free agent with the New York Knicks; received FROM_TRADE as compensation.'],
    ]);
  });

  it('reads waiver claims by other teams', () => {
    const { moves } = parseTransactionPage(fx('transactions-buf-1976.html'), 1975, '1976_transactions');
    expect(moves[0]).toMatchObject({ kind: 'claim', parts: [{ from: LAC, to: SAC, kind: 'player', person: { bbrefId: 'winfile01' } }] });
  });

  it('reads coach hires, firings, interim appointments, resignations and a coach traded for', () => {
    const y1976 = parseTransactionPage(fx('transactions-buf-1976.html'), 1975, '1976_transactions').moves;
    expect(y1976.slice(1).map((m) => [m.kind, m.parts[0].from, m.parts[0].to, m.parts[0].person!.bbrefId])).toEqual([
      ['fire', LAC, null, 'ramsaja99c'], ['hire', null, LAC, 'locketa99c'],
    ]);
    const interim = parseTransactionPage(fx('transactions-buf-1977.html'), 1976, '1977_transactions').moves
      .find((m) => m.parts[0].text === 'Interim Head Coach')!;
    expect(interim).toMatchObject({ kind: 'hire', sourceKey: 'bbref:1977-01-25:hire:name:bob-mackinnon' });
    expect(interim.parts[0].person).toEqual({ name: 'Bob MacKinnon' });

    const y1980 = parseTransactionPage(fx('transactions-sdc-1980.html'), 1979, '1980_transactions').moves;
    expect(y1980[0]).toMatchObject({ kind: 'other', parts: [{ from: LAC, to: null, kind: 'other', person: { bbrefId: 'shuege01c' }, text: 'Resigned as Head Coach' }] });
    const silas = y1980.find((m) => m.kind === 'trade')!;
    expect(silas.parts[1]).toEqual({ from: OKC, to: LAC, kind: 'other', person: { bbrefId: 'silaspa01c', name: 'Paul Silas' }, text: 'Head Coach' });
  });

  it('drops a move BBRef lists twice under one date', () => {
    const r = parseTransactionPage(fx('transactions-lac-1987.html'), 1986, '1987_transactions');
    expect(r.moves.map((m) => m.sourceKey)).toEqual(['bbref:1986-11-17:signing:fieldke01', 'bbref:1986-11-17:waiver:johnsst02']);
    expect(r.skipped).toEqual([{ source: '1987_transactions', index: 2, date: '1986-11-17', text: 'Waived Steffond Johnson.', reason: 'duplicate' }]);
    expect(r.unparsed).toEqual([]);
  });

  // ---- notes after the main sentence (ruling R7: kept raw, not interpreted) --------------------------

  it('keeps note text after the sentence as raw notes', () => {
    const novak = parseTransactionPage(fx('transactions-lac-2009.html'), 2008, '2009_transactions').moves[0];
    expect(novak.parts.map((p) => p.kind)).toEqual(['pick', 'player']);
    expect(novak.notes).toEqual(['swap, not exercised']);

    const y2014 = parseTransactionPage(fx('transactions-lac-2014.html'), 2013, '2014_transactions').moves;
    const mullens = y2014.find((m) => m.parts.some((p) => p.person?.bbrefId === 'mulleby01'))!;
    expect(mullens.notes).toEqual(['(Pick is conditional and did not convey.)']);
    expect(mullens.notes!.some((n) => n.includes('did not convey'))).toBe(true);
    // no notes -> no field
    const plain = y2014.find((m) => m.parts.some((p) => p.person?.bbrefId === 'jamisan01'))!;
    expect('notes' in plain).toBe(false);
  });

  it('splits notes BBRef runs together', () => {
    const harris = parseTransactionPage(fx('transactions-lac-2019.html'), 2018, '2019_transactions').moves[0];
    expect(harris.notes).toEqual(['2021 1st-rd pick was MIA own', '2021 2nd-rd pick was DET own', '2023 2nd-rd pick was DET own']);

    const y2021 = parseTransactionPage(fx('transactions-lac-2021.html'), 2020, '2021_transactions').moves;
    expect(y2021.find((m) => m.date === '2021-03-22')!.notes).toEqual([
      'condition 2022 2nd-rd pick (ATL own) did not convey',
      'conditional 2022 2nd-rd pick did not convey',
      'Los Angeles received a trade exception.',
    ]);
    // the plain-text "James Nnaji was later selected" stays in the sentence, the note after it is kept
    expect(y2021.find((m) => m.parts.some((p) => p.person?.bbrefId === 'lessoma01'))!.notes).toEqual(['2023 2nd-rd pick was DET own']);
  });
});

