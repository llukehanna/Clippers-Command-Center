// scripts/lib/insights/engine/run.ts
// One engine run (spec §2, §5.1): detect → frame → triviality filter → render
// → evidence → score → combined proof → store, per surface. Every detector runs
// before anything is written, so a failing detector never leaves a half-run
// (no upserts, no deactivation).
import { scopeForSurface, type Surface } from '../../../../src/lib/insights/types';
import { paramsRecord } from '../proof-utils.js';
import { loadEngineContext } from './context.js';
import { daysBetween } from './dates.js';
import { DETECTORS } from './detectors/index.js';
import { buildEntities, buildEvidence } from './evidence.js';
import { blockedFrames, frameFact, PBP_KINDS } from './framer.js';
import { factKey } from './keys.js';
import { pbpRecordsComplete } from './pbp-coverage.js';
import { combineProof, selectProofRows, type ProofPart } from './proof.js';
import { runQuery } from './query.js';
import { questionsFor } from './questions.js';
import { LATE_JOINERS_SQL, lateJoinerGuard } from './references.js';
import { renderSeason } from './records.js';
import { renderInsight } from './render.js';
import { isTrivial, probability, salienceClass, scoreInsight, unchangedSince } from './score.js';
import { deactivateLegacy, deactivateRetired, deactivateStale, upsertInsight } from './store.js';
import type { Detector, DetectorOutput, EngineContext, Fact, FactKind, InsightDraft, Runner } from './types.js';

export interface RunOptions {
  surfaces: Surface[];
  asOf: string;
  write: boolean;
  gameId?: string | null;
  /** Postgame window in days (default 3). */
  postgameDays?: number;
  log?: (msg: string) => void;
  /** Override the registry (tests). */
  detectors?: readonly Detector[];
}

export type DropReason = 'former' | 'trivial' | 'too_long' | 'unprovable' | 'duplicate';
export interface DroppedFact { key: string; detector: string; reason: DropReason; kind: FactKind; stat: string; subject: string }

export interface EngineResult {
  context: EngineContext | null;
  drafts: InsightDraft[];
  dropped: DroppedFact[];
  upserted: number;
  deactivated: number;
  legacyDeactivated: number;
  retiredDeactivated: number;
}

/** Days from the fact to the reference date; a completed season is measured from its last game. */
export function ageDays(fact: Fact, ctx: EngineContext): number {
  const seasonal = fact.surface === 'season' || fact.surface === 'player';
  const ref = seasonal && !ctx.season.isCurrent ? ctx.season.lastGameDate : ctx.asOf;
  return daysBetween(fact.context.date, ref);
}

/** Loads (once per season and date) the late joiners a guarded fact's subject frames depend on (references.lateJoinerGuard, FW-6). */
export async function loadLateJoiners(fact: Fact, ctx: EngineContext, run: Runner = runQuery): Promise<void> {
  const guard = lateJoinerGuard(fact, ctx);
  if (!guard || ctx.lateJoiners?.has(guard.key)) return;
  const rows = await run({ sql: LATE_JOINERS_SQL, params: [ctx.lac.teamId, guard.seasonId, guard.date] });
  (ctx.lateJoiners ??= new Map()).set(guard.key, new Set(rows.map((r) => String(r.player_id))));
}

export async function buildDraft(
  fact: Fact, key: string, detector: string, ctx: EngineContext, run: Runner = runQuery,
): Promise<InsightDraft | { reason: DropReason }> {
  const cls = fact.surface === 'pregame' && fact.data.opponent_player ? 'opponent' : salienceClass(fact.subject, ctx.roster);
  if (cls === 'former' && fact.surface !== 'postgame') return { reason: 'former' };

  await loadLateJoiners(fact, ctx, run);
  // Play-by-play record frames are only honest when every earlier Clippers game in range has play-by-play.
  const pbpComplete = PBP_KINDS.has(fact.kind) ? await pbpRecordsComplete(ctx, fact.context.date, run) : true;
  const framed = await frameFact(fact, ctx, run, questionsFor(fact), blockedFrames(fact, pbpComplete));
  if (isTrivial(probability(fact.sample), framed.frame.type, fact.kind)) return { reason: 'trivial' };

  // Postgame claims freeze after their window, so they name their season, "so far" because their references stop at the game date (a later game may beat it).
  const factSeason = renderSeason(fact.seasonId, ctx.season, ctx.asOf, fact.context.date);
  const season = fact.surface === 'postgame'
    ? { ...factSeason, isCurrent: false, phrase: `so far in ${factSeason.label}` }
    : factSeason;
  const rendered = renderInsight(fact, framed.frame, { surface: fact.surface, season, teams: ctx.teams }, key);
  if (!rendered) return { reason: 'too_long' };
  const frame = { ...framed.frame, text: rendered.context };

  const proof = combineProof(fact.proof, framed.proof);
  const rows = selectProofRows((await run(proof)) as unknown as ProofPart[], fact.proof.match);
  if (!rows) return { reason: 'unprovable' };

  const prior = ctx.prior.get(key) ?? null;
  const score = scoreInsight({
    surface: fact.surface, kind: fact.kind, sample: fact.sample, frameStrength: frame.strength, salienceClass: cls,
    polarity: fact.polarity, ageDays: ageDays(fact, ctx), asOf: ctx.asOf,
    firstEmittedAt: prior?.firstEmittedAt ?? null,
    unchangedSince: unchangedSince(prior, rendered.headline, frame.type, ctx.asOf),
  });

  return {
    key, detector, surface: fact.surface, scope: scopeForSurface(fact.surface), category: fact.kind,
    team_id: ctx.lac.teamId, game_id: fact.gameId,
    player_id: fact.subject.type === 'player' ? fact.subject.id : null, season_id: fact.seasonId,
    headline: rendered.headline, detail: rendered.context, importance: score.importance,
    proof_sql: proof.sql, proof_params: paramsRecord(proof.params), proof_result: rows,
    frame, evidence: buildEvidence(fact, frame), entities: buildEntities(fact, ctx), score_parts: score,
  };
}

export async function runEngine(opts: RunOptions): Promise<EngineResult> {
  const log = opts.log ?? (() => {});
  if (opts.gameId && opts.surfaces.some((s) => s !== 'postgame')) {
    throw new Error('gameId runs cover the postgame surface only');
  }
  const ctx = await loadEngineContext({
    asOf: opts.asOf, gameId: opts.gameId ?? null, withPrior: opts.write, postgameDays: opts.postgameDays,
  });
  if (!ctx) return { context: null, drafts: [], dropped: [], upserted: 0, deactivated: 0, legacyDeactivated: 0, retiredDeactivated: 0 };
  if (!ctx.league.complete) {
    log(`::warning title=League data incomplete::${ctx.league.reason} — league-wide detectors and frames are skipped`);
  }

  const detectors = (opts.detectors ?? DETECTORS).filter((d) => opts.surfaces.includes(d.surface));
  const outputs: { detector: Detector; out: DetectorOutput }[] = [];
  for (const detector of detectors) {
    const out = await detector.run(ctx);
    // A null gameIds means "the whole surface", which for postgame would deactivate every game's rows.
    if (detector.surface === 'postgame' && out.gameIds === null) {
      throw new Error(`postgame detector ${detector.name} returned gameIds null; postgame detectors must name the games they covered`);
    }
    for (const f of out.facts) {
      if (f.surface !== detector.surface || !detector.categories.includes(f.kind)) {
        throw new Error(`${detector.name} emitted ${f.surface}/${f.kind}, outside its scope ${detector.surface}/${detector.categories.join(',')}`);
      }
      if (detector.surface === 'postgame' && (f.gameId === null || !out.gameIds!.includes(f.gameId))) {
        throw new Error(`${detector.name} emitted a fact for game ${f.gameId}, which it did not cover`);
      }
    }
    outputs.push({ detector, out });
  }

  const seen = new Set<string>();
  const drafts: InsightDraft[] = [];
  const dropped: DroppedFact[] = [];
  for (const { detector, out } of outputs) {
    for (const fact of out.facts) {
      const key = factKey(fact);
      const drop = (reason: DropReason) =>
        dropped.push({ key, detector: detector.name, reason, kind: fact.kind, stat: fact.stat, subject: fact.subject.name });
      if (seen.has(key)) { drop('duplicate'); continue; }
      seen.add(key);
      const draft = await buildDraft(fact, key, detector.name, ctx);
      if ('reason' in draft) drop(draft.reason);
      else drafts.push(draft);
    }
  }

  if (!opts.write) return { context: ctx, drafts, dropped, upserted: 0, deactivated: 0, legacyDeactivated: 0, retiredDeactivated: 0 };

  for (const d of drafts) await upsertInsight(d);
  let deactivated = 0;
  for (const { detector, out } of outputs) {
    const kept = drafts.filter((d) => d.detector === detector.name).map((d) => d.key);
    deactivated += await deactivateStale({ surface: detector.surface, categories: detector.categories, gameIds: out.gameIds }, kept);
  }
  const legacyDeactivated = await deactivateLegacy();
  const retiredDeactivated = await deactivateRetired();
  return { context: ctx, drafts, dropped, upserted: drafts.length, deactivated, legacyDeactivated, retiredDeactivated };
}
