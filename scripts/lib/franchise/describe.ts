// scripts/lib/franchise/describe.ts
// transactions.description: text WE generate from a move's parts (spec §1), never source prose or notes.
//
// The sentence is from the Clippers' side when they're in the move, else from the first team named; that team is the
// subject ("The Boston Celtics signed …"), implied for the Clippers ("Signed …"). Teams get their era name for the
// move's season ("the Seattle SuperSonics" in 1975). Assets are worded from their structured fields: people by
// person key (personName) or their ref's name, picks as "a 2005 second-round pick" (same-round picks grouped: "2005
// and 2006 second-round picks"). A part with nothing structured to word (a vague pick, "future considerations")
// uses its `text`. Pure.
import { resolveEra } from '../history/team-eras.js';
import { NBA_TEAM_IDS, TRICODE_BY_NBA_ID } from '../nba-teams.js';
import type { MergedMove } from './reconcile-moves.js';
import type { FranchiseId, MovePart } from './types.js';

const LAC = NBA_TEAM_IDS.LAC;

/** Season start year of a YYYY-MM-DD date (July on is the next season). */
export function seasonOfDate(date: string): number {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 7 ? y : y - 1;
}

/**
 * "Seattle SuperSonics" for OKC in 1975. A team not yet playing that season (a draft-night trade before its first
 * season) gets next season's name, then its current one; an unknown id its number.
 */
export function eraTeamName(f: FranchiseId, seasonId: number): string {
  const tri = TRICODE_BY_NBA_ID[f];
  const era = tri ? resolveEra(tri, seasonId) ?? resolveEra(tri, seasonId + 1) ?? resolveEra(tri, 9999) : null;
  return era ? `${era.city} ${era.name}` : `team ${f}`;
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`;
const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Name = (f: FranchiseId) => string;

export function describeMove(
  m: MergedMove,
  nameOf: (f: FranchiseId, seasonId: number) => string,
  personName: (key: string) => string,
): string {
  const season = seasonOfDate(m.date);
  const team: Name = (f) => `the ${nameOf(f, season)}`;

  const who = (p: MovePart): string => {
    if (!p.person) return p.text ?? 'a player';
    const key = p.personKey ?? p.person.bbrefId ?? (p.person.nbaPersonId != null ? `nba:${p.person.nbaPersonId}` : null);
    return (key ? personName(key) : '') || p.person.name;
  };

  /** One asset; picks are worded by `assets` so same-round picks can be grouped. */
  const asset = (p: MovePart): string => {
    switch (p.kind) {
      case 'player':
        return who(p);
      case 'draft_rights':
        return p.person ? `the draft rights to ${who(p)}` : p.text ?? 'draft rights';
      case 'swap':
        return p.swap ? `the right to swap ${p.swap.year} ${ordinal(p.swap.round)}-round picks` : p.text ?? 'a pick swap';
      case 'cash':
        return 'cash';
      case 'exception':
        return 'a trade exception';
      case 'pick':
        return p.text ?? 'an unidentified draft pick';
      default:
        return p.person ? who(p) : p.text ?? 'other considerations';
    }
  };

  /** Assets in part order; identified picks follow, same-round picks of other years grouped. */
  const assets = (parts: MovePart[]): string => {
    const out: string[] = [];
    const groups: Array<{ round: number; years: number[] }> = [];
    for (const p of parts) {
      const pk = p.kind === 'pick' ? p.pick : undefined;
      if (!pk || pk.vague || !(pk.year > 0) || !(pk.round > 0)) {
        out.push(asset(p));
        continue;
      }
      const owner = pk.originalFranchiseId;
      if (owner != null && owner !== p.from) {
        const t = team(owner);
        out.push(`${t}${t.endsWith('s') ? "'" : "'s"} ${pk.year} ${ordinal(pk.round)}-round pick`);
        continue;
      }
      const g = groups.find((x) => x.round === pk.round && !x.years.includes(pk.year));
      if (g) g.years.push(pk.year);
      else groups.push({ round: pk.round, years: [pk.year] });
    }
    for (const g of groups) {
      const years = [...g.years].sort((a, b) => a - b);
      out.push(years.length === 1 ? `a ${years[0]} ${ordinal(g.round)}-round pick` : `${list(years.map(String))} ${ordinal(g.round)}-round picks`);
    }
    return list(out);
  };

  const touches = (f: FranchiseId) => m.parts.some((p) => p.from === f || p.to === f);
  const P: FranchiseId | null = touches(LAC) ? LAC : m.parts.map((p) => p.from ?? p.to).find((f) => f != null) ?? null;
  const out = m.parts.filter((p) => P != null && p.from === P);
  const inc = m.parts.filter((p) => P != null && p.to === P);
  const people = (parts: MovePart[]) => list(parts.map(who));
  const firstOther = (parts: MovePart[], end: 'from' | 'to') => parts.map((p) => p[end]).find((f) => f != null && f !== P) ?? null;
  const at = (f: FranchiseId | null, word: 'to' | 'from') => (f != null ? ` ${word} ${team(f)}` : '');

  /** Groups parts by the other team, in first-seen order. */
  const byTeam = (parts: MovePart[], end: 'from' | 'to') => {
    const groups = new Map<FranchiseId | null, MovePart[]>();
    for (const p of parts) (groups.get(p[end]) ?? groups.set(p[end], []).get(p[end])!).push(p);
    return [...groups];
  };

  const transfer = (): string => {
    const others = new Set([...out.map((p) => p.to), ...inc.map((p) => p.from)].filter((f): f is FranchiseId => f != null && f !== P));
    const thirdParty = m.parts.some((p) => !out.includes(p) && !inc.includes(p));
    if (others.size <= 1 && !thirdParty) {
      const T = [...others][0] ?? null;
      if (out.length && inc.length) return `traded ${assets(out)}${at(T, 'to')} for ${assets(inc)}`;
      if (out.length) return `traded ${assets(out)}${at(T, 'to')}`;
      return `acquired ${assets(inc)}${at(T, 'from')}`;
    }
    const sent = byTeam(out, 'to').map(([f, ps]) => `${assets(ps)}${at(f, 'to')}`);
    const got = byTeam(inc, 'from').map(([f, ps]) => `${assets(ps)}${at(f, 'from')}`);
    const n = new Set(m.parts.flatMap((p) => [p.from, p.to]).filter((f) => f != null)).size;
    const size = `in a ${NUMBER_WORDS[n] ?? n}-team trade`;
    if (sent.length && got.length) return `traded ${list(sent)}, and acquired ${list(got)}, ${size}`;
    if (sent.length) return `traded ${list(sent)}, ${size}`;
    return `acquired ${list(got)}, ${size}`;
  };

  /** [verb phrase, whether it names its own subject] */
  const phrase = ((): [string, boolean] => {
    const role = (p: MovePart | undefined) => (p?.text ? ` as ${p.text.toLowerCase()}` : '');
    switch (m.kind) {
      case 'trade':
        return [transfer(), false];
      case 'signing': {
        const signed = inc.filter((p) => p.from == null);
        const lost = out.filter((p) => p.kind === 'player' && p.to != null);
        if (signed.length) {
          const comp = out.filter((p) => p.to != null);
          const tail = comp.length ? ` and sent ${assets(comp)}${at(firstOther(comp, 'to'), 'to')} as compensation` : '';
          return [`signed ${people(signed)}${tail}`, false];
        }
        if (lost.length) {
          const comp = inc.filter((p) => p.from != null);
          const tail = comp.length ? ` and received ${assets(comp)} as compensation` : '';
          return [`lost ${people(lost)}${at(firstOther(lost, 'to'), 'to')} in free agency${tail}`, false];
        }
        return [`signed ${people(inc.length ? inc : m.parts)}`, false];
      }
      case 're_signing':
        return [`re-signed ${people(inc.length ? inc : m.parts)}`, false];
      case 'extension':
        return [`signed ${people(m.parts)} to a contract extension`, false];
      case 'two_way':
        return [`signed ${people(m.parts)} to a two-way contract`, false];
      case 'ten_day':
        return [`signed ${people(m.parts)} to a 10-day contract`, false];
      case 'conversion':
        return [`converted ${people(m.parts)} to a standard contract`, false];
      case 'waiver':
        return [`waived ${people(m.parts)}`, false];
      case 'release':
        return [`released ${people(m.parts)}`, false];
      case 'claim':
        if (inc.length) return [`claimed ${people(inc)} off waivers${at(firstOther(inc, 'from'), 'from')}`, false];
        return [`lost ${people(out)} on waivers${at(firstOther(out, 'to'), 'to')}`, false];
      case 'draft':
        return [`drafted ${people(inc.length ? inc : m.parts)}`, false];
      case 'expansion_draft':
        if (out.length) return [`lost ${people(out)}${at(firstOther(out, 'to'), 'to')} in the expansion draft`, false];
        return [`selected ${people(inc)}${at(firstOther(inc, 'from'), 'from')} in the expansion draft`, false];
      case 'sale':
        if (out.length) return [`sold ${assets(out)}${at(firstOther(out, 'to'), 'to')}`, false];
        return [`bought ${assets(inc)}${at(firstOther(inc, 'from'), 'from')}`, false];
      case 'retirement':
        return [`${people(m.parts)} retired`, true];
      case 'hire':
        return [`hired ${who(m.parts[0])}${role(m.parts[0])}`, false];
      case 'fire':
        return [`fired ${who(m.parts[0])}${role(m.parts[0])}`, false];
      default: {
        // An event about one person ("resigned as head coach"), else a plain transfer.
        const p = m.parts[0];
        if (m.parts.length === 1 && p.person && p.text) return [`${who(p)} ${p.text.toLowerCase()}`, true];
        return [transfer(), false];
      }
    }
  })();

  const [vp, ownSubject] = phrase;
  if (ownSubject || P === LAC || P == null) return cap(vp);
  return `The ${nameOf(P, season)} ${vp}`;
}
