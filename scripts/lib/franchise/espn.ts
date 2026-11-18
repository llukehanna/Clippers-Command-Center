// scripts/lib/franchise/espn.ts
// ESPN: draft rounds (core API) -> trade notes by overall pick; site-API transactions prose -> moves.
import { createHash } from 'node:crypto';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { normalizePersonName } from '../player-match.js';
import { cleanName } from './nba-movement.js';
import { franchiseFromName } from './team-names.js';
import type { MoveKind, ParsedMove, PersonRef, UnparsedLine } from './types.js';

const LAC = NBA_TEAM_IDS.LAC;

export function parseEspnDraftRounds(json: unknown, _year: number): Array<{ overall: number; tradeNote: string | null }> {
  const items = (json as { items?: Array<{ picks?: Array<{ overall?: number; tradeNote?: string | null }> }> })?.items ?? [];
  const out: Array<{ overall: number; tradeNote: string | null }> = [];
  for (const round of items) {
    for (const p of round.picks ?? []) {
      if (typeof p.overall !== 'number') continue;
      out.push({ overall: p.overall, tradeNote: p.tradeNote?.trim() ? p.tradeNote.trim() : null });
    }
  }
  return out;
}

const POS = String.raw`(?:[GFC](?:-[GFC])?s?\s+)?`;
const NAME = String.raw`(.+?)`;

function seasonOf(date: string): number {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 7 ? y : y - 1;
}

const hash = (s: string) => createHash('sha1').update(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).digest('hex').slice(0, 10);

/** Split a description into sentences without breaking "Jr." / "Sr." */
function sentences(text: string): string[] {
  // Not after "Jr"/"Sr", a lone initial ("J. Cole") or a dotted pair ("P.J.").
  return text
    .split(/(?<!\bJr)(?<!\bSr)(?<!\b[A-Z])(?<![A-Z]\.[A-Z])\.\s+(?=[A-Z])/)
    .map(cleanName)
    .filter(Boolean);
}

export function parseEspnTransactions(
  json: unknown,
  roster: Array<{ name: string; nbaPersonId: number | null }>,
): { moves: ParsedMove[]; unparsed: UnparsedLine[] } {
  const txs = (json as { transactions?: Array<{ date?: string; description?: string }> })?.transactions ?? [];
  const moves: ParsedMove[] = [];
  const unparsed: UnparsedLine[] = [];
  const person = (name: string): PersonRef => {
    const key = normalizePersonName(name);
    const hits = roster.filter((r) => normalizePersonName(r.name) === key);
    return hits.length === 1 && hits[0].nbaPersonId != null ? { nbaPersonId: hits[0].nbaPersonId, name } : { name };
  };
  txs.forEach((tx, index) => {
    const date = (tx.date ?? '').slice(0, 10);
    const desc = tx.description ?? '';
    for (const s of sentences(desc)) {
      const add = (kind: MoveKind, name: string, from: number | null, to: number | null) =>
        moves.push({
          sourceKey: `espn:${date}:${hash(`${s}|${name}`)}`,
          date,
          kind,
          parts: [{ from, to, kind: 'player', person: person(name) }],
          involvesClippers: from === LAC || to === LAC,
          complete: true,
        });
      let m: RegExpExecArray | null;
      if ((m = new RegExp(`^Signed ${POS}${NAME} to a two-way contract$`, 'i').exec(s))) add('two_way', m[1], null, LAC);
      else if ((m = new RegExp(`^Signed ${POS}${NAME} to an? (?:\\d+(?:st|nd|rd|th) )?10-day contract$`, 'i').exec(s))) add('ten_day', m[1], null, LAC);
      else if ((m = new RegExp(`^Signed ${POS}${NAME}(?: to an? [a-z0-9 -]+)?$`, 'i').exec(s))) add('signing', m[1], null, LAC);
      else if ((m = new RegExp(`^Re-signed ${POS}${NAME}(?: to an? [a-z0-9 -]+)?$`, 'i').exec(s))) add('re_signing', m[1], null, LAC);
      else if ((m = new RegExp(`^Waived ${POS}(.+)$`, 'i').exec(s))) {
        for (const name of m[1].split(/\s*,\s*|\s+and\s+/).map(cleanName).filter(Boolean)) add('waiver', name, LAC, null);
      } else if ((m = new RegExp(`^Acquired ${POS}${NAME} from (.+)$`, 'i').exec(s))) {
        const from = date ? franchiseFromName(m[2], seasonOf(date)) : null;
        if (from == null) unparsed.push({ source: 'espn', index, date: date || null, text: s.endsWith(".") ? s : `${s}.` });
        else add('trade', m[1], from, LAC);
      } else unparsed.push({ source: 'espn', index, date: date || null, text: s.endsWith(".") ? s : `${s}.` });
    }
  });
  return { moves, unparsed };
}
