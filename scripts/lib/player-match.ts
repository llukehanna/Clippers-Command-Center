// scripts/lib/player-match.ts
// Pure helpers for mapping NBA box-score players (NBA personId + name) onto
// rows in the players table, which is keyed by balldontlie ids.
// Zero DB imports — safe to unit test without DATABASE_URL.

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/**
 * Canonical form of a person's name for equality matching across providers:
 * strips diacritics ("Jokić" → "jokic"), punctuation ("De'Aaron", "P.J."),
 * generational suffixes ("Jr.", "III"), lowercases, and collapses whitespace.
 */
export function normalizePersonName(name: string | null | undefined): string {
  const tokens = (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

/** Split a display name into first / last for a new players row. */
export function splitPersonName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export interface PlayerNameCandidate {
  player_id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
}

/**
 * Choose the single players row that matches `name`, or null when there is
 * no match or the match is ambiguous. Candidates should already be limited to
 * rows with nba_person_id IS NULL (a row with a different personId is a
 * different human). When several rows share the name, a sole is_active row
 * wins; otherwise we refuse to guess.
 */
export function pickUniqueNameMatch(
  name: string,
  candidates: PlayerNameCandidate[]
): PlayerNameCandidate | null {
  const target = normalizePersonName(name);
  if (!target) return null;
  const matches = candidates.filter(
    (c) =>
      normalizePersonName(c.display_name) === target ||
      normalizePersonName(`${c.first_name} ${c.last_name}`) === target
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const active = matches.filter((c) => c.is_active);
    if (active.length === 1) return active[0];
  }
  return null;
}
