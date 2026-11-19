// scripts/lib/insights/engine/framer.ts
// For each fact, ask the reference questions that apply (spec §2.3) and keep
// the strongest frame. Queries run through an injected Runner, so this module
// is DB-free and unit-testable.
import type { Frame, FrameType } from '../../../../src/lib/insights/types';
import { computedFrames, pickFrame } from './strength.js';
import type { EngineContext, Fact, ProofQuery, Row, Runner } from './types.js';

export interface Question {
  name: string;
  /** The frame query, or null when the question doesn't apply to this fact. */
  build(fact: Fact, ctx: EngineContext): ProofQuery | null;
  interpret(rows: Row[], fact: Fact, ctx: EngineContext): Frame | null;
}

export interface FramedFact {
  frame: Frame;
  /** The winning frame's query (null for computed frames and none). */
  proof: ProofQuery | null;
}

/** Fact kinds measured from play-by-play: game flow, quarters, halves and clutch. */
export const PBP_KINDS: ReadonlySet<Fact['kind']> = new Set<Fact['kind']>(['game_flow', 'player_period_stat', 'team_period_stat', 'clutch']);

/**
 * Frames that claim "nobody has done this since records start" (or this season, or
 * count occurrences): a missing game could hide a bigger value or an occurrence. Over
 * play-by-play they are only true when every Clippers game in range has play-by-play.
 */
export const PBP_RECORD_FRAMES: ReadonlySet<FrameType> = new Set<FrameType>([
  'records_best', 'first_since', 'only_one', 'joins_company', 'clippers_rank', 'season_high', 'nth_time',
]);

/** The frame types a fact may not use: its record frames when it is play-by-play and the games before it are not all ingested. */
export function blockedFrames(fact: Fact, pbpComplete: boolean): ReadonlySet<FrameType> | undefined {
  return PBP_KINDS.has(fact.kind) && !pbpComplete ? PBP_RECORD_FRAMES : undefined;
}

export async function frameFact(
  fact: Fact, ctx: EngineContext, run: Runner, questions: readonly Question[], blocked?: ReadonlySet<FrameType>,
): Promise<FramedFact> {
  const candidates: FramedFact[] = computedFrames(fact).map((frame) => ({ frame, proof: null }));
  for (const q of questions) {
    const query = q.build(fact, ctx);
    if (!query) continue;
    const rows = await run(query);
    const frame = q.interpret(rows, fact, ctx);
    if (frame && !blocked?.has(frame.type)) candidates.push({ frame: { ...frame, proof_rows: rows }, proof: query });
  }
  const best = pickFrame(candidates.map((c) => c.frame));
  return candidates.find((c) => c.frame === best) ?? { frame: best, proof: null };
}
