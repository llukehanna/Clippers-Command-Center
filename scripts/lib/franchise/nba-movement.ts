// scripts/lib/franchise/nba-movement.ts
// NBA.com player-movement feed ({"NBA_Player_Movement":{"rows":[...]}}) -> structured moves.
// Non-trade rows are one move each; trade rows are grouped by GroupSort into one move. Anything that
// can't be read (an unresolvable counterparty, an unknown description) is returned in `unparsed`.
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { franchiseFromName } from './team-names.js';
import type { FranchiseId, MoveKind, MovePart, ParsedMove, UnparsedLine } from './types.js';

const LAC = NBA_TEAM_IDS.LAC;

interface Row {
  Transaction_Type: string;
  TRANSACTION_DATE: string;
  TRANSACTION_DESCRIPTION: string;
  TEAM_ID: number;
  PLAYER_ID: number;
  GroupSort: string;
}

const POS = String.raw`(?:(?:guard|forward|center)(?:[-/](?:guard|forward|center))?\s+)?`;
const POS_RE = new RegExp(`^${POS}`);

/** Season id (start year) for a YYYY-MM-DD date: July through June. */
function seasonOf(date: string): number {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 7 ? y : y - 1;
}

function personOf(row: Row, name: string) {
  return row.PLAYER_ID ? { nbaPersonId: row.PLAYER_ID, name } : { name };
}

/** Drops the sentence-ending period but keeps the one that belongs to "Jr." / "Sr.". */
export function cleanName(raw: string): string {
  const t = raw.trim();
  if (/\b(?:Jr|Sr)\.+$/.test(t)) return t.replace(/\.+$/, '.');
  return t.replace(/\.$/, '').trim();
}

/** The player name from the text after the verb, with the position word removed and trailing period dropped. */
function nameFrom(text: string, stop: RegExp): string | null {
  const body = text.replace(POS_RE, '');
  const m = stop.exec(body);
  const name = cleanName(m ? body.slice(0, m.index) : body);
  return name || null;
}

function singleKind(row: Row): MoveKind | null {
  const d = row.TRANSACTION_DESCRIPTION;
  switch (row.Transaction_Type) {
    case 'Signing':
      if (/\bre-signed\b/i.test(d)) return 're_signing';
      if (/two-way/i.test(d)) return 'two_way';
      if (/10-day/i.test(d)) return 'ten_day';
      return 'signing';
    case 'Waive': return 'waiver';
    case 'ContractConverted': return 'conversion';
    case 'AwardOnWaivers': return 'claim';
    default: return null;
  }
}

const VERBS: Record<string, { re: RegExp; stop: RegExp }> = {
  signing: { re: /^(.+?) (?:re-)?signed (.+)$/i, stop: / to an? /i },
  waiver: { re: /^(.+?) waived (.+)$/i, stop: /(?!)/ },
  conversion: { re: /^(.+?) converted the contract of (.+)$/i, stop: / to an? /i },
  claim: { re: /^(.+?) claimed (.+)$/i, stop: / off waivers/i },
};

function parseSingle(row: Row, date: string): ParsedMove | null {
  const kind = singleKind(row);
  if (!kind) return null;
  const verb = VERBS[kind === 're_signing' || kind === 'two_way' || kind === 'ten_day' ? 'signing' : kind];
  const m = verb.re.exec(row.TRANSACTION_DESCRIPTION);
  if (!m) return null;
  const name = nameFrom(m[2], verb.stop);
  if (!name) return null;
  const team: FranchiseId = row.TEAM_ID;
  const part: MovePart = {
    from: kind === 'waiver' ? team : null,
    to: kind === 'waiver' ? null : team,
    kind: 'player',
    person: personOf(row, name),
  };
  return {
    sourceKey: `nba:${row.GroupSort}:${row.PLAYER_ID}`,
    date,
    kind,
    parts: [part],
    involvesClippers: team === LAC,
    complete: true,
  };
}

const TRADE_ROW = /^.+? received (.+?) from (.+?)\.?$/;

/** One trade group -> a move, or the reason it can't be built. */
function parseTrade(rows: Row[], date: string): ParsedMove | string {
  const season = seasonOf(date);
  const parts: MovePart[] = [];
  for (const row of rows) {
    const m = TRADE_ROW.exec(row.TRANSACTION_DESCRIPTION);
    if (!m) return `unreadable trade row: ${row.TRANSACTION_DESCRIPTION}`;
    const sender = franchiseFromName(m[2], season);
    if (sender == null) return `unresolved team "${m[2]}": ${row.TRANSACTION_DESCRIPTION}`;
    const what = m[1];
    const base = { from: sender, to: row.TEAM_ID as FranchiseId };
    if (/^draft consideration$/i.test(what)) {
      parts.push({ ...base, kind: 'pick', text: 'draft consideration', gap: 'pick_unidentified' });
    } else if (/^cash$/i.test(what)) {
      parts.push({ ...base, kind: 'cash', text: 'cash' });
    } else if (row.PLAYER_ID) {
      parts.push({ ...base, kind: 'player', person: personOf(row, what.replace(POS_RE, '').trim()) });
    } else {
      return `unreadable trade asset "${what}": ${row.TRANSACTION_DESCRIPTION}`;
    }
  }
  return {
    sourceKey: `nba:${rows[0].GroupSort}`,
    date,
    kind: 'trade',
    parts,
    involvesClippers: rows.some((r) => r.TEAM_ID === LAC),
    complete: parts.every((p) => !p.gap),
  };
}

export function parseMovement(json: unknown, since?: string): { moves: ParsedMove[]; unparsed: UnparsedLine[] } {
  const rows = ((json as { NBA_Player_Movement?: { rows?: Row[] } })?.NBA_Player_Movement?.rows ?? []);
  const moves: ParsedMove[] = [];
  const unparsed: UnparsedLine[] = [];
  const groups = new Map<string, Row[]>();
  const order: Array<Row | string> = [];
  rows.forEach((row) => {
    if (row.Transaction_Type === 'Trade') {
      const g = groups.get(row.GroupSort);
      if (g) g.push(row);
      else { groups.set(row.GroupSort, [row]); order.push(row.GroupSort); }
    } else order.push(row);
  });
  const fail = (date: string, index: number, text: string) => unparsed.push({ source: 'nba', index, date, text });
  order.forEach((item, index) => {
    const first = typeof item === 'string' ? groups.get(item)![0] : item;
    const date = first.TRANSACTION_DATE.slice(0, 10);
    if (since && date < since) return;
    if (typeof item === 'string') {
      const r = parseTrade(groups.get(item)!, date);
      if (typeof r === 'string') fail(date, index, r);
      else moves.push(r);
      return;
    }
    const r = parseSingle(item, date);
    if (r) moves.push(r);
    else fail(date, index, item.TRANSACTION_DESCRIPTION);
  });
  return { moves, unparsed };
}
