// src/lib/franchise/pick-holder.ts
// Who holds a pick now, under the pipeline's data model. Pure.
//
// draft_picks.final_owner_franchise_id stays NULL for future picks. A pick's
// current holder is the to_franchise_id of its most recent linked
// transaction_parts row (that pick_id, latest transaction date); with no linked
// part, the holder is the original franchise. A latest part with no receiver
// leaves the holder unknown (null), never guessed.
//
// Unlinked pick parts (pick_id null, gap 'pick_unidentified') keep the source's
// words in unlinked_text, e.g. "a 2027 second round draft pick". pickMention reads
// the year(s) and round from those words so a loader can flag a pick that may
// have moved without a link.

export interface HolderPart {
  from_franchise_id: number | null;
  to_franchise_id: number | null;
  date: string | null;
  transaction_id: string | number;
}

/** Linked parts in time order: undated first (they can't be placed), then date, then transaction id. */
export function byTime<T extends HolderPart>(parts: T[]): T[] {
  return [...parts].sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date == null) return -1;
      if (b.date == null) return 1;
      return a.date < b.date ? -1 : 1;
    }
    return Number(a.transaction_id) - Number(b.transaction_id);
  });
}

/** The pick's current holder: the latest linked part's receiver; the original franchise when no part links it. */
export function currentHolder(originalFranchiseId: number, parts: HolderPart[]): number | null {
  if (parts.length === 0) return originalFranchiseId;
  return byTime(parts).at(-1)!.to_franchise_id;
}

const ROUND_WORDS: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3 };

/**
 * Draft years and round named in an unlinked pick's text. Empty years / null round
 * when the text doesn't say ("a future draft pick", "draft consideration").
 */
export function pickMention(text: string | null): { years: number[]; round: number | null } {
  if (!text) return { years: [], round: null };
  const years = [...text.matchAll(/\b(19[4-9]\d|20\d\d)\b/g)].map((m) => Number(m[1]));
  const word = /\b(first|second|third|1st|2nd|3rd)[\s-]+round\b/i.exec(text);
  const numbered = /\bround\s+(\d)\b/i.exec(text);
  const round = word ? ROUND_WORDS[word[1].toLowerCase()] : numbered ? Number(numbered[1]) : null;
  return { years: [...new Set(years)], round };
}

/**
 * Whether an unlinked part's text could be this pick: it names the draft year, and
 * the same round when it names one.
 */
export function mentionsPick(text: string | null, draftYear: number, round: number): boolean {
  const m = pickMention(text);
  return m.years.includes(draftYear) && (m.round == null || m.round === round);
}
