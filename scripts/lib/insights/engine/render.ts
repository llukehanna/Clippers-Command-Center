// scripts/lib/insights/engine/render.ts
// Picks a claim's phrasing by its key (stable across runs) and enforces the
// 90-character headline (spec §2.5). Pure.
import type { Frame } from '../../../../src/lib/insights/types';
import { phrasingIndex } from './keys.js';
import { TEMPLATES } from './templates/index.js';
import type { Phrasing, RenderContext, Rendered } from './templates/shared.js';
import type { Fact } from './types.js';

export const MAX_HEADLINE = 90;

export function phrasingsFor(fact: Fact, frame: Frame): Phrasing[] {
  const mod = TEMPLATES[fact.kind];
  return mod[frame.type] ?? mod.default;
}

/** The chosen phrasing; the shortest when it overflows; null when even that is over 90 characters. */
export function renderInsight(fact: Fact, frame: Frame, rc: RenderContext, key: string): Rendered | null {
  const list = phrasingsFor(fact, frame);
  const chosen = list[phrasingIndex(key, list.length)](fact, frame, rc);
  if (chosen.headline.length <= MAX_HEADLINE) return chosen;
  const shortest = list.map((p) => p(fact, frame, rc)).sort((a, b) => a.headline.length - b.headline.length)[0];
  return shortest.headline.length <= MAX_HEADLINE ? shortest : null;
}
