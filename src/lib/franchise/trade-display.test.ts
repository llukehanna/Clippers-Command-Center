import { describe, it, expect } from 'vitest'
import { assetSummary, protectionsTone, rootRows, sidePanels, sourceNames, tradeHeadline, treeGroups } from './trade-display'
import type { FranchiseTeamRef, TradeAsset, TradeSide, TreeNode } from '@/src/lib/ui/types'

const team = (franchise_id: number, abbreviation: string, city: string, name: string, is_clippers = false): FranchiseTeamRef => ({
  franchise_id,
  abbreviation,
  city,
  name,
  is_clippers,
})
const LAC = team(1610612746, 'LAC', 'LA', 'Clippers', true)
const OKC = team(1610612760, 'OKC', 'Oklahoma City', 'Thunder')
const DET = team(1610612765, 'DET', 'Detroit', 'Pistons')
const SAC = team(1610612758, 'SAC', 'Sacramento', 'Kings')
const BUF = team(1610612746, 'BUF', 'Buffalo', 'Braves', true)

const person = (name: string) => ({ person_key: name.toLowerCase().replace(/\W/g, ''), name, player_id: null, nba_person_id: null, href: null })

const asset = (over: Partial<TradeAsset>): TradeAsset => ({
  kind: 'player',
  label: 'X',
  href: null,
  person: null,
  pick: null,
  swap: null,
  counterparty: null,
  gap_reason: null,
  gap_note: null,
  ...over,
})
const player = (name: string, counterparty: FranchiseTeamRef | null) => asset({ kind: 'player', label: name, person: person(name), counterparty })
const pick = (year: number, round: number, original: FranchiseTeamRef, counterparty: FranchiseTeamRef | null, label = `${year} pick`) =>
  asset({
    kind: 'pick',
    label,
    counterparty,
    pick: {
      pick_key: `${year}-${round}-${original.franchise_id}`,
      draft_year: year,
      round,
      original_team: original,
      overall_pick: null,
      status: 'used',
      protections_known: true,
      protections_text: null,
      protections_label: 'Unprotected',
    },
  })
const swap = (year: number, counterparty: FranchiseTeamRef) =>
  asset({
    kind: 'swap',
    label: `${year} first-round swap`,
    counterparty,
    swap: {
      swap_key: `${year}-1`,
      draft_year: year,
      round: 1,
      teams: [LAC, OKC],
      exercised: null,
      protections_known: true,
      protections_text: null,
      protections_label: 'Unprotected',
    },
  })

const node = (label: string, team: FranchiseTeamRef | null, over: Partial<TreeNode> = {}): TreeNode => ({
  label,
  kind: 'player',
  href: null,
  note: null,
  children: [],
  truncatedAt: null,
  person: null,
  date: null,
  team,
  ...over,
})

const pgSides: TradeSide[] = [
  {
    team: LAC,
    received: [player('Paul George', OKC)],
    sent: [player('Shai Gilgeous-Alexander', OKC), pick(2022, 1, LAC, OKC), pick(2021, 1, team(1610612748, 'MIA', 'Miami', 'Heat'), OKC), swap(2023, OKC)],
  },
  {
    team: OKC,
    received: [player('Shai Gilgeous-Alexander', LAC), pick(2022, 1, LAC, LAC), pick(2021, 1, team(1610612748, 'MIA', 'Miami', 'Heat'), LAC), swap(2023, LAC)],
    sent: [player('Paul George', LAC)],
  },
]

const threeSides: TradeSide[] = [
  { team: LAC, received: [player('Luke Kennard', DET)], sent: [player('Rodney McGruder', SAC)] },
  { team: DET, received: [asset({ kind: 'player', label: 'Delon Wright', person: person('Delon Wright'), gap_reason: 'party_unknown', gap_note: 'team not recorded' })], sent: [player('Luke Kennard', LAC)] },
  { team: SAC, received: [player('Rodney McGruder', LAC)], sent: [] },
]

describe('tradeHeadline', () => {
  it('names the trade after the first person its description mentions', () => {
    expect(tradeHeadline('The Clippers acquired Paul George from Oklahoma City for Shai Gilgeous-Alexander.', pgSides)).toBe('Paul George trade')
    expect(tradeHeadline('Houston acquired Shai Gilgeous-Alexander. The Clippers received Paul George.', pgSides)).toBe('Shai Gilgeous-Alexander trade')
  })

  it('marks deals with three or more teams', () => {
    expect(tradeHeadline('A three-team deal sent Luke Kennard to Los Angeles.', threeSides)).toBe('Luke Kennard three-team trade')
  })

  it('falls back to a player the Clippers received, then to the other teams', () => {
    expect(tradeHeadline('A trade.', pgSides)).toBe('Paul George trade')
    const noPeople: TradeSide[] = [
      { team: LAC, received: [asset({ kind: 'cash', label: 'Cash' })], sent: [] },
      { team: OKC, received: [], sent: [] },
    ]
    expect(tradeHeadline('Cash for nothing.', noPeople)).toBe('Trade with Oklahoma City')
  })
})

describe('assetSummary', () => {
  it('counts players, picks by round, swaps and cash in plain words', () => {
    expect(assetSummary(pgSides[1].received)).toBe('1 player · 2 firsts · 1 swap')
    expect(assetSummary([player('A', null), player('B', null), pick(2030, 2, LAC, null), asset({ kind: 'cash', label: 'Cash' })])).toBe(
      '2 players · 1 second · cash',
    )
  })

  it('counts an unidentified pick without guessing its round', () => {
    expect(assetSummary([asset({ kind: 'pick', label: 'a future second-round pick', gap_reason: 'pick_unidentified' })])).toBe('1 pick')
  })

  it('says so when nothing was recorded', () => {
    expect(assetSummary([])).toBe('nothing recorded')
  })
})

describe('sourceNames', () => {
  it('maps key prefixes to source names in priority order, once each', () => {
    expect(sourceNames(['wiki:x', 'nba:Trade 1', 'bbref:Trade 2', 'nba:Trade 3'])).toEqual(['NBA.com', 'Basketball Reference', 'Wikipedia'])
    expect(sourceNames(['espn:1', 'other:2'])).toEqual(['ESPN', 'other'])
  })
})

describe('protectionsTone', () => {
  it('never reads unknown protections as unprotected', () => {
    expect(protectionsTone(null, 'Protections not recorded')).toBe('unknown')
    expect(protectionsTone(false, 'Protections not recorded')).toBe('unknown')
    expect(protectionsTone(true, 'Unprotected')).toBe('plain')
    expect(protectionsTone(true, 'Top-14 protected')).toBe('protected')
  })
})

describe('sidePanels', () => {
  it('reads a two-team deal from the Clippers side: got, then gave', () => {
    const panels = sidePanels(pgSides)
    expect(panels.map((p) => [p.title, p.team?.abbreviation, p.aside, p.assets.length])).toEqual([
      ['Clippers got', 'LAC', 'from Oklahoma City', 1],
      ['Clippers gave', 'OKC', 'to Oklahoma City', 4],
    ])
  })

  it('uses the era name (Braves got / Braves gave)', () => {
    const SEA = team(1610612760, 'SEA', 'Seattle', 'SuperSonics')
    const panels = sidePanels([
      { team: BUF, received: [player('Dean Tolson', SEA)], sent: [player('Bob Kauffman', SEA)] },
      { team: SEA, received: [player('Bob Kauffman', BUF)], sent: [player('Dean Tolson', BUF)] },
    ])
    expect(panels.map((p) => [p.title, p.aside])).toEqual([['Braves got', 'from Seattle'], ['Braves gave', 'to Seattle']])
  })

  it('shows each side of a three-team deal, a party_unknown part under the team we know', () => {
    const panels = sidePanels(threeSides)
    expect(panels.map((p) => [p.title, p.assets.map((a) => a.label)])).toEqual([
      ['Clippers got', ['Luke Kennard']],
      ['Pistons got', ['Delon Wright']],
      ['Kings got', ['Rodney McGruder']],
    ])
  })

  it('keeps parts with no recorded receiver in their own panel', () => {
    const orphan = player('Mystery Man', null)
    const panels = sidePanels([threeSides[0], { ...threeSides[1], sent: [...threeSides[1].sent, orphan] }, threeSides[2]])
    expect(panels.at(-1)).toMatchObject({ title: 'Receiver not recorded', team: null, assets: [orphan] })
  })

  it('keeps a part the other team received from an unrecorded sender (two-team deal)', () => {
    const cash = asset({ kind: 'cash', label: 'cash considerations', counterparty: null })
    const panels = sidePanels([pgSides[0], { ...pgSides[1], received: [...pgSides[1].received, cash] }])
    expect(panels.map((p) => [p.title, p.team?.abbreviation, p.aside, p.assets.length])).toEqual([
      ['Clippers got', 'LAC', 'from Oklahoma City', 1],
      ['Clippers gave', 'OKC', 'to Oklahoma City', 4],
      ['Thunder got', 'OKC', 'sender not recorded', 1],
    ])
    expect(panels[2].assets).toEqual([cash])
  })
})

describe('treeGroups and rootRows', () => {
  it('groups outline rows by who received them, with the same headings as the sides', () => {
    const became = [node('Paul George', LAC), node('Shai Gilgeous-Alexander', OKC), node('2022 pick', OKC, { kind: 'pick' })]
    const groups = treeGroups(became, pgSides)
    expect(groups.map((g) => [g.heading, g.team?.abbreviation, g.rows.map((r) => r.title)])).toEqual([
      ['Clippers got', 'LAC', ['Paul George']],
      ['Clippers gave', 'OKC', ['Shai Gilgeous-Alexander', '2022 1st']],
    ])
  })

  it('labels picks and swaps by year and round with the original team, matched by label', () => {
    const rows = rootRows(
      [node('2021 pick', OKC, { kind: 'pick' }), node('2023 first-round swap', OKC, { kind: 'swap' }), node('a future second-round pick', LAC, { kind: 'pick' })],
      pgSides,
    )
    expect(rows.map((r) => [r.title, r.meta, r.logo, r.glyph])).toEqual([
      ['2021 1st', 'MIA', 'MIA', 'pick'],
      ['2023 1st swap', null, null, 'swap'],
      ['A future second-round pick', null, null, 'pick'],
    ])
  })

  it('does not group a part with an unrecorded sender under "Clippers gave"', () => {
    const cash = asset({ kind: 'cash', label: 'cash considerations', counterparty: null })
    const sides = [pgSides[0], { ...pgSides[1], received: [...pgSides[1].received, cash] }]
    const became = [node('Paul George', LAC), node('Shai Gilgeous-Alexander', OKC), node('cash considerations', OKC, { kind: 'cash' })]
    expect(treeGroups(became, sides).map((g) => [g.heading, g.team?.abbreviation, g.rows.map((r) => r.title)])).toEqual([
      ['Clippers got', 'LAC', ['Paul George']],
      ['Clippers gave', 'OKC', ['Shai Gilgeous-Alexander']],
      ['Thunder got · sender not recorded', 'OKC', ['Cash considerations']],
    ])
  })

  it('puts rows with no receiver last under "Receiver not recorded"', () => {
    const groups = treeGroups([node('Paul George', LAC), node('Cash', null, { kind: 'cash' })], pgSides)
    expect(groups.map((g) => g.heading)).toEqual(['Clippers got', 'Receiver not recorded'])
  })
})
