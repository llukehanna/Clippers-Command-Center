// scripts/lib/insights/engine/replay.ts
// insights:replay (spec §5.3): ranked feeds per placement with score parts,
// for tuning. Pure.
import {
  composeFeed, PLACEMENT_SURFACES, type ComposableInsight, type Placement,
} from '../../../../src/lib/insights/compose';
import type { Surface } from '../../../../src/lib/insights/types';
import { parseEngineArgs, type EngineArgs } from './cli.js';
import type { EngineResult } from './run.js';
import type { InsightDraft } from './types.js';

export const REPLAY_PLACEMENTS: Placement[] = ['home_hero', 'last_game', 'up_next', 'season_feed', 'player_page'];

export function parseReplayArgs(argv: string[], today: string): EngineArgs {
  if (!argv.some((a) => a.startsWith('--as-of='))) throw new Error('insights:replay needs --as-of=YYYY-MM-DD');
  if (argv.some((a) => a.startsWith('--game='))) {
    throw new Error('insights:replay replays whole surfaces; use generate-insights --dry --surface=postgame --game=<id> for one game');
  }
  return { ...parseEngineArgs(argv.filter((a) => a !== '--dry'), today), write: false };
}

export function toComposable(d: InsightDraft): ComposableInsight {
  return {
    insight_id: d.key.slice(0, 12), surface: d.surface, category: d.category, importance: d.importance,
    headline: d.headline, detail: d.detail, game_id: d.game_id, player_id: d.player_id,
    frame: d.frame, score_parts: d.score_parts,
  };
}

const prob = (v: number | null) => (v === null ? '—' : v < 0.001 ? v.toExponential(1) : v.toFixed(3));

export function formatReplay(result: Pick<EngineResult, 'drafts' | 'dropped'>, surfaces: Surface[]): string {
  const items = result.drafts.map(toComposable);
  const lines: string[] = [];
  for (const placement of REPLAY_PLACEMENTS) {
    if (!PLACEMENT_SURFACES[placement].some((s) => surfaces.includes(s))) continue;
    // The player page is one feed per player; every other placement is one feed.
    const groups = placement === 'player_page'
      ? [...new Set(items.filter((i) => i.surface === 'player' && i.player_id).map((i) => i.player_id as string))].map((id) => ({
          title: `${placement} · ${result.drafts.find((d) => d.player_id === id && d.surface === 'player')?.entities[0]?.name ?? id}`,
          items: items.filter((i) => i.player_id === id),
        }))
      : [{ title: placement, items }];
    if (groups.length === 0) groups.push({ title: placement, items: [] });
    for (const group of groups) {
      lines.push(`\n── ${group.title} ──`);
      const feed = composeFeed(group.items, placement);
      if (feed.length === 0) lines.push('  (empty)');
      for (const item of feed) {
        const d = result.drafts.find((x) => x.key.startsWith(item.insight_id))!;
        const s = d.score_parts;
        lines.push(`  [${String(d.importance).padStart(3)}] ${d.headline}`);
        lines.push(`        ${item.detail ?? ''}`);
        lines.push(`        ${d.surface}/${d.category} frame=${d.frame.type}(${d.frame.strength}) p=${prob(s.p)} ` +
          `rarity=${s.rarity.toFixed(2)} sal=${s.salience} rec=${s.recency.toFixed(2)} pol=${s.polarity} nov=${s.novelty.toFixed(2)}`);
      }
    }
  }
  const reasons = new Map<string, number>();
  for (const d of result.dropped) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
  lines.push(`\n${result.drafts.length} insights; dropped ${[...reasons.entries()].map(([r, n]) => `${r} ${n}`).join(', ') || 'none'}`);
  return lines.join('\n');
}
