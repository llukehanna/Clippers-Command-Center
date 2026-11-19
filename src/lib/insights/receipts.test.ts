import { describe, expect, it } from 'vitest';
import type { InsightCardData } from './card';
import { formatVerified, receiptTable, sampleLabel } from './receipts';
import type { Frame } from './types';

function frame(over: Partial<Frame> = {}): Frame {
  return { type: 'first_since', strength: 0.5, who: 'subject', text: '', proof_rows: [], ...over };
}

function card(over: Partial<InsightCardData> = {}): InsightCardData {
  return {
    insight_id: 'i1', surface: 'postgame', category: 'player_game_stat', headline: 'h', detail: null, importance: 70,
    player_id: '9', game_id: '1', season_id: 2026,
    subject: { kind: 'player', name: 'Brook Lopez', nba_person_id: 1 },
    context_label: 'x', fact_date: '2026-11-15', href: null, frame: null, evidence: null, proof: [],
    updated_at: '2026-11-19T07:40:00Z', merged_ids: [],
    ...over,
  };
}

const proof = [
  { part: 'fact' as const, data: { game_date: '2026-11-15', value: 8, subject_name: 'Brook Lopez' } },
  { part: 'frame' as const, data: { game_date: '2018-03-26', value: 9, games_since: 715 } },
];

describe('receiptTable', () => {
  it('builds whitelisted columns in order with formatted dates', () => {
    const t = receiptTable(card({ frame: frame({ stat: 'ast' }), proof }))!;
    expect(t.columns.map((c) => c.label)).toEqual(['Date', 'Player', 'AST', 'Games between']);
    expect(t.rows[0].me).toBe(true);
    expect(t.rows[1].me).toBe(false);
    expect(t.rows[0].cells[0]).toBe('Nov 15, 2026');
    expect(t.rows[1].cells[0]).toBe('Mar 26, 2018');
    expect(t.columns[2].numeric).toBe(true);
    expect(t.columns[1].numeric).toBe(false);
    expect(t.source.startsWith('Proof query re-run nightly · last verified ')).toBe(true);
    expect(t.source.endsWith('Records since 1996–97')).toBe(false);
  });

  it("fills the fact row's Player cell with the subject when the row omits it", () => {
    const rows = [
      { part: 'fact' as const, data: { game_date: '2026-11-15', value: 8 } },
      { part: 'frame' as const, data: { game_date: '2018-03-26', value: 9, subject_name: 'Brook Lopez' } },
    ];
    const t = receiptTable(card({ frame: frame({ stat: 'ast' }), proof: rows }))!;
    expect(t.columns.map((c) => c.label)).toEqual(['Date', 'Player', 'AST']);
    expect(t.rows[0].cells).toEqual(['Nov 15, 2026', 'Brook Lopez', '8']);
    // A non-fact row keeps its own (or no) name
    const t2 = receiptTable(card({ proof: [rows[0], { part: 'frame', data: { value: 2 } }, rows[1]] }))!;
    expect(t2.rows[1].cells[1]).toBe('—');
    // No Player column, nothing added
    expect(receiptTable(card({ proof: [rows[0]] }))!.columns.map((c) => c.key)).toEqual(['game_date', 'value']);
  });

  it('appends the records label', () => {
    const t = receiptTable(card({ frame: frame({ stat: 'ast', records_label: '1996-97' }), proof }))!;
    expect(t.source.endsWith(' · Records since 1996–97')).toBe(true);
  });

  it('unknown stat labels the value column Value; season formats', () => {
    const t = receiptTable(card({ proof: [{ part: 'fact', data: { season_id: 2025, value: 3 } }] }))!;
    expect(t.columns.map((c) => c.label)).toEqual(['Season', 'Value']);
    expect(t.rows[0].cells).toEqual(['2025–26', '3']);
  });

  it('caps at 8 rows', () => {
    const many = Array.from({ length: 12 }, () => ({ part: 'frame' as const, data: { rank: 2 } }));
    expect(receiptTable(card({ proof: many }))!.rows).toHaveLength(8);
  });

  it('keeps the fact row when capping', () => {
    const frames = Array.from({ length: 9 }, () => ({ part: 'frame' as const, data: { rank: 2 } }));
    const t = receiptTable(card({ proof: [...frames, { part: 'fact', data: { rank: 1 } }] }))!;
    expect(t.rows).toHaveLength(8);
    expect(t.rows[0]).toEqual({ cells: ['1'], me: true });
  });

  it('tolerates null part data', () => {
    const bad = [{ part: 'fact', data: null }, { part: 'frame', data: { rank: 2 } }] as unknown as InsightCardData['proof'];
    expect(() => receiptTable(card({ proof: bad }))).not.toThrow();
    expect(receiptTable(card({ proof: bad }))!.rows[0].cells).toEqual(['—']);
  });

  it('non-array proof (empty parts) is null', () => {
    expect(receiptTable(card({ proof: [] }))).toBeNull();
  });
});

describe('formatVerified', () => {
  it('shows Pacific time', () => {
    expect(formatVerified('2026-11-19T07:40:00Z')).toBe('Nov 18, 11:40 PM PT');
  });
});

describe('sampleLabel', () => {
  it('records_label', () => {
    expect(sampleLabel(card({ frame: frame({ records_label: '1996-97' }) }))).toBe('Box scores since 1996–97');
  });
  it('rank_track', () => {
    expect(sampleLabel(card({ evidence: { type: 'rank_track', rank: 1, total: 30, betterIsHigher: true, label: 'x' } }))).toBe('30 ranked');
  });
  it('yoy games', () => {
    expect(sampleLabel(card({ category: 'yoy_change', proof: [{ part: 'fact', data: { games: 13 } }] }))).toBe('13 games');
  });
  it('anything else', () => {
    expect(sampleLabel(card())).toBeNull();
  });
});
