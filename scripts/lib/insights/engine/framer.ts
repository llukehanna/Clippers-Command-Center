// scripts/lib/insights/engine/framer.ts
// For each fact, ask the reference questions that apply (spec §2.3) and keep
// the strongest frame. Queries run through an injected Runner, so this module
// is DB-free and unit-testable.
import type { Frame } from '../../../../src/lib/insights/types';
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

export async function frameFact(fact: Fact, ctx: EngineContext, run: Runner, questions: readonly Question[]): Promise<FramedFact> {
  const candidates: FramedFact[] = computedFrames(fact).map((frame) => ({ frame, proof: null }));
  for (const q of questions) {
    const query = q.build(fact, ctx);
    if (!query) continue;
    const rows = await run(query);
    const frame = q.interpret(rows, fact, ctx);
    if (frame) candidates.push({ frame: { ...frame, proof_rows: rows }, proof: query });
  }
  const best = pickFrame(candidates.map((c) => c.frame));
  return candidates.find((c) => c.frame === best) ?? { frame: best, proof: null };
}
