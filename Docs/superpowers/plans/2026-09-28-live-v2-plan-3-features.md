# Live v2 — Plan 3: Game Flow, Rotation Clipboard, Spoiler Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/live` gets the three features ESPN doesn't have: a game-flow chart with a calibrated win-probability line, a rotation clipboard (who's on the floor, stint timers, foul trouble, minutes against usual, tonight's units), and spoiler sync that holds the whole page back to match the fan's TV or stream. It also closes the Plan 2 gap where a runner that never started left fans with "no game".

**Architecture:**
- **Runner derives everything.** The game-night runner already rebuilds one `LiveStateDoc` per change. It now also derives `flow` (score-change series + markers), `wp` (model `stern-v1`) and `lineups` (stints and units) from the play-by-play and box score it already fetches. One derivation, so the chart, clipboard and scoreboard can't disagree.
- **Calibrated model.** A pure `win-prob.ts` is shared by the runner, the calibration script and the UI. `npm run calibrate-wp` fits σ over past Clippers games (`game_flow.margin_series`) by Brier score and stores it in `app_kv`; the runner reads it at start.
- **Protocol grows one field.** Deltas carry `flow_append` (only new points), so the ~200-point series doesn't ride every delta.
- **Spoiler sync is a client buffer.** `useLiveStream` keeps 150 s of frames keyed by when the real play happened (device clock) and renders the newest frame at least `delay` old. Everything on the page reads that one payload, so the scoreboard, sticky score, tab title, chart and clipboard all hold together.

**Tech Stack:** TypeScript, Next.js 16 (App Router), React 19 + SWR, Recharts 3, Tailwind 4, Vitest 4, postgres.js, GitHub Actions.

**Spec:** `Docs/superpowers/specs/2026-09-27-live-v2-realtime-design.md` — §7 (features), §4 (state + messages), §9 (failure modes: runner not started, clock skew), §10 (tests, calibration check). Plan 3 of 3. Plans 1 (`…-plan-1-runner.md`) and 2 (`…-plan-2-push-hub.md`) are merged and deployed; the hub is live at `live.lukeghanna.com`.

## Global Constraints

- **Imports:**
  - Code reachable from `app/` (anything `app/api/**` or a page imports, including `scripts/lib/live-*` via the cron route and everything `scripts/lib/live-state.ts` imports) uses **suffix-less relative imports** (`from './live-flow'`). `.js` suffixes break `next build`.
  - Tests and standalone CLI scripts (`scripts/*.ts`) may keep the existing `.js` style.
- **Verification before every commit:** `npm test`, `npx tsc --noEmit -p .` (prints nothing), `npm run lint` (no new warnings), and **`npm run build`**.
- **Unit-tested modules stay DB-free:** modules imported by unit tests must not import `scripts/lib/db.ts` or `src/lib/db.ts`.
- **Dependencies:** no new dependencies. Charts use the existing `recharts` with `components/charts/chart-theme.tsx`.
- **Documentation paths:** git tracks documentation under `Docs/` (capital D).
- **Model constants (spec §7.1):**
  - Model id `stern-v1`: P(LAC wins) = Φ((m + E·r) / (σ·√r)); r = regulation seconds left ÷ 2,880; in overtime, the OT period's seconds left ÷ 2,880; at r = 0 a tie is 0.5.
  - E = −(LAC closing spread) from `odds_snapshots` (latest snapshot captured at or before tip); fallback +2.5 when LAC is home, −2.5 away.
  - Default σ = 12.5 until calibrated. Calibration grid σ ∈ [8, 18] step 0.1, samples every 60 s of regulation.
  - `app_kv` key `wp:model`. The calibration refuses to store a fit whose Brier is worse than the stored one by more than **0.005** (exits 1).
  - Always labeled a model estimate in the UI, never a verified insight.
- **Clipboard constants (spec §7.2):**
  - Foul trouble at ≥ 2 fouls in Q1, ≥ 3 in Q2, ≥ 4 in Q3, ≥ 5 in Q4/OT.
  - Minutes vs usual: projected minutes (minutes × 2,880 ÷ elapsed) more than 25 % off the last-10-game average (`rolling_player_stats`, `window_games = 10`) is flagged; not judged before 12:00 of game time.
  - Units: Clippers five-man units, top 5 by seconds together.
- **Flow constants (spec §7.1):** one point per score change plus the tip (t = 0) and each period end; run markers at ≥ 8 unanswered points (same threshold as `detectScoringRun` in `src/lib/insights/live.ts`).
- **Spoiler constants (spec §7.3):**
  - Delay 0–120 s, whole seconds, stored in `localStorage` key `ccc:spoiler-delay-ms`. Presets Off, TV 8 s, Stream 30 s.
  - Frame buffer 150 s (always keeping the newest frame older than that as a floor).
  - Clock offset = the smallest of the last 20 samples of (device receive time − hub `hub_at`).
  - With a delay set and nothing old enough buffered yet, the page holds (shows no score) instead of showing a newer one.
- **Names:** new state fields are `flow`, `wp`, `lineups` on `LiveStateDoc` and `LivePayload`; `LivePayload` also gains `observed_at`. All optional on `LiveStateDoc`, since rows written before this plan lack them.
- **Approvals:** production actions (writing `app_kv` in the production database, pushing, merging) need Luke's go-ahead in chat. Everything else runs locally.
- **Commit trailer:** commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deferred items and deviations

- **Deferred (next spec or never):**
  - Possession and bonus adjustments to WP (spec: out of scope for v1).
  - Logging ESPN's per-play WP alongside ours during the preseason (spec §7.1 sanity check). The feed probe can add it; nothing displays it.
  - The replay harness (`npm run replay-live`, spec §10). Unit tests cover each derivation; the preseason game is the end-to-end check.
  - Runner ESPN `summary` source on sustained NBA 403s (carried from Plan 2).
- **Deviations (rulings):**
  - **The 0:00 WP point is the model's own pregame value, Φ(E/σ), not the no-vig moneyline.** One model end to end, no jump at the first basket. During a game the scoreboard's win-probability bar shows the model value (labeled "model estimate"); before tip, and for games without `wp`, it keeps the moneyline value.
  - **Calibration data is `game_flow.margin_series`** (every Clippers game since 2010, all seasons), not `pbp_events`, whose raw rows are pruned after each season. It is Clippers games, not the whole league. Most older games have no stored spread, so they use the home-court E.
  - **The "CI fails on a Brier regression" check runs nightly in `post-game.yml`**, not in PR CI, which has no database access.
  - **The clipboard is a tab next to the box score at every width** (spec: "on mobile it is its own tab"). One layout, and desktop keeps the insights column.
  - **`LineupUnit` carries `names`** alongside `player_ids`, so the UI needs no roster lookup.
  - **Period-start substitutions:** the NBA feed doesn't always log substitutions between periods. A player on the floor whose last logged substitution was "out" is treated as back since the start of the next period; a unit tally can drift across such a boundary. Accepted for v1.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/types/live-state.ts` (modify) | New types: `FlowPoint`, `FlowMarker`, `LiveFlow`, `LiveWinProb`, `WpCalibration`, `ReliabilityBin`, `StintPlayer`, `LineupUnit`, `LineupState`; optional `flow`/`wp`/`lineups` on `LiveStateDoc` |
| `src/lib/types/live.ts` (modify) | `BoxscoreTeam.timeoutsRemaining?`, `BoxscoreTeam.inBonus?` (the CDN box score has them) |
| `src/lib/live/win-prob.ts` (create) | Pure `stern-v1` model, game-clock helpers, `expectedLacMargin` |
| `scripts/lib/wp-calibrate.ts` (create) | Pure σ fit: samples, Brier, grid search, reliability table |
| `scripts/calibrate-wp.ts` (create) | CLI: read `game_flow` + odds, fit, compare, store `app_kv` `wp:model` |
| `scripts/lib/live-flow.ts` (create) | Pure flow series + markers from play-by-play |
| `scripts/lib/live-lineups.ts` (create) | Pure stints, foul trouble, minutes pace, units |
| `scripts/lib/live-state.ts` (modify) | `ModelContext`; builds `wp`, `flow`, `lineups` |
| `scripts/lib/live-poller.ts` (modify) | `createPoller(…, model?)` passes the model to the builder |
| `scripts/lib/live-store.ts` (modify) | `loadModelContext(sql, gameDbId)` |
| `scripts/game-night.ts`, `app/api/cron/poll-live/route.ts` (modify) | Load the model context once, pass it to the poller |
| `src/lib/live/protocol.ts` (modify) | `flow_append` in deltas |
| `src/lib/live/payload.ts` (modify) | `overlayLiveDoc` copies the new fields; `notStartedPayload` |
| `src/lib/ui/types.ts` (modify) | `LivePayload.flow/wp/lineups/observed_at` |
| `app/api/live/route.ts` (modify) | New fields in LIVE/DATA_DELAYED; runner-not-started shell |
| `src/lib/live/flow-view.ts` (create) | Pure chart helpers (rows, ticks, summary, labels) |
| `components/live/GameFlow.tsx` (create) | Flow chart + WP line + markers + "About this model" |
| `components/live/Clipboard.tsx` (create) | Rotation clipboard |
| `hooks/useMediaQuery.ts` (create) | `useSyncExternalStore` media query |
| `components/game/WinProbabilityBar.tsx` (modify) | `source` label: moneyline vs model |
| `src/lib/live/spoiler.ts` (create) | Pure frame buffer, delay pick, sync, clock offset |
| `hooks/useLiveStream.ts` (modify) | Records frames, applies the delay, exposes `spoiler` |
| `components/live/SpoilerControl.tsx` (create) | Delay presets, slider, "Sync to my screen" |
| `components/live/LiveView.tsx`, `app/live/page.tsx` (modify) | Wire the new panels, the hold state and the control |
| `app/dev/live/fixture.ts` (modify) | Sample `flow`, `wp`, `lineups` for `/dev/live` |
| `.github/workflows/post-game.yml`, `package.json` (modify) | `calibrate-wp` script and nightly step |

---

### Task 0: Branch

The worktree already exists: `/Users/luke/Claude Projects/CCC-live-v3`, branch `live/v2-plan3` from `origin/main` 3c75544 (Plan 2 merged). `npm install` has run in the root and in `workers/live-hub`.

- [ ] **Step 1: Confirm the baseline**

Run: `cd "/Users/luke/Claude Projects/CCC-live-v3" && git status --short && npm test 2>&1 | grep -E "Tests " && npx tsc --noEmit -p . && npm run build 2>&1 | grep -E "Compiled|error"`
Expected: clean tree (apart from this plan), all tests pass, tsc prints nothing, "Compiled successfully".

- [ ] **Step 2: Commit the plan**

```bash
git add Docs/superpowers/plans/2026-09-28-live-v2-plan-3-features.md
git commit -m "docs: Live v2 plan 3 (game flow, clipboard, spoiler sync)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Feature types and the win-probability model

**Files:**
- Modify: `src/lib/types/live-state.ts`
- Create: `src/lib/live/win-prob.ts`
- Test: `src/lib/live/win-prob.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (every later task relies on these exact names):
  - Types in `src/lib/types/live-state.ts`: `FlowPoint`, `FlowMarker`, `LiveFlow`, `ReliabilityBin`, `WpCalibration`, `LiveWinProb`, `StintPlayer`, `LineupUnit`, `LineupState`; `LiveStateDoc.flow?`, `.wp?`, `.lineups?`.
  - `src/lib/live/win-prob.ts`: `PERIOD_SECS = 720`, `OT_SECS = 300`, `REGULATION_SECS = 2880`, `DEFAULT_SIGMA = 12.5`, `HOME_COURT_MARGIN = 2.5`, `normalCdf(z)`, `elapsedSecs(period, clockSec)`, `periodClockAt(t) → {period, clockSec}`, `periodName(period)`, `formatClock(secs)`, `formatGameTime(t)`, `remainingFraction(period, clockSec)`, `winProbability({margin, period, clockSec, expected, sigma})`, `expectedLacMargin(lacSpread, lacIsHome) → {expected, source}`.

- [ ] **Step 1: Add the types**

Append to `src/lib/types/live-state.ts` (after `LiveRecentScoring`, before `LiveStateDoc`):

```ts
/** One point of the game-flow series: the tip, a score change, or a period end (spec §7.1). */
export interface FlowPoint {
  t: number;                   // game seconds elapsed (regulation 0–2880, overtime beyond)
  m: number;                   // LAC margin after this action
  wp: number;                  // LAC win probability 0–1 at this moment (model estimate)
  a: number;                   // action_number (0 for the tip)
  d: string;                   // play description ('' for the tip and period ends)
}

export type FlowMarker =
  | { kind: 'run'; t: number; t_start: number; side: 'lac' | 'opp'; pts: number }
  | { kind: 'timeout'; t: number; side: 'lac' | 'opp' }
  | { kind: 'lead_change'; t: number; side: 'lac' | 'opp' }   // side = the new leader
  | { kind: 'period_end'; t: number; period: number }
  | { kind: 'max_lead'; t: number; side: 'lac' | 'opp'; margin: number };

export interface LiveFlow {
  points: FlowPoint[];         // ascending t; append-only while the feed only appends
  markers: FlowMarker[];       // ascending t
}

export interface ReliabilityBin {
  lo: number;                  // predicted-probability bin [lo, hi)
  hi: number;
  n: number;                   // samples in the bin
  mean_p: number;              // mean predicted probability
  observed: number;            // share of those samples where LAC won
}

/** The fitted model, stored in app_kv 'wp:model' by scripts/calibrate-wp.ts. */
export interface WpCalibration {
  sigma: number;
  brier: number;
  n_games: number;
  n_samples: number;
  fitted_at: string;
  reliability: ReliabilityBin[];
}

export interface LiveWinProb {
  lac: number;                 // 0–1, rounded to 3 decimals
  model: 'stern-v1';
  sigma: number;
  expected_margin: number;     // pregame expected LAC margin (E)
  expected_source: 'spread' | 'home_court';
  calibration: WpCalibration | null;
}

/** One player on the floor (spec §7.2). */
export interface StintPlayer {
  player_id: number;           // NBA personId
  name: string;                // "K. Leonard"
  stint_start: { period: number; clock: string };
  stint_secs: number;
  stint_plus_minus: number;    // from this player's team's side
  pf: number;
  foul_trouble: boolean;
  min: number;                 // minutes tonight, 1 decimal
  usual_min: number | null;    // last-10-game average
  pace: 'over' | 'under' | null;
}

export interface LineupUnit {
  player_ids: number[];        // ascending
  names: string[];             // same order as player_ids
  secs: number;
  plus_minus: number;          // LAC side
}

export interface LineupState {
  on_court: { lac: StintPlayer[]; opp: StintPlayer[] };
  current_unit: { lac_plus_minus: number; secs_together: number };
  units_tonight: LineupUnit[]; // LAC five-man units, top 5 by seconds
  timeouts: { lac: number | null; opp: number | null };
  bonus: { lac: boolean; opp: boolean };
}
```

Then add three optional fields at the end of `LiveStateDoc` (after `stale_reason`):

```ts
  // Plan 3 (spec §7). Optional: rows written before Plan 3 lack them.
  flow?: LiveFlow | null;      // null before tip
  wp?: LiveWinProb | null;
  lineups?: LineupState | null; // null until both box scores exist
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/live/win-prob.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SIGMA,
  elapsedSecs,
  expectedLacMargin,
  formatClock,
  formatGameTime,
  normalCdf,
  periodClockAt,
  periodName,
  remainingFraction,
  winProbability,
} from './win-prob';

describe('normalCdf', () => {
  it('matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(1) + normalCdf(-1)).toBeCloseTo(1, 7);
  });
});

describe('game clock', () => {
  it('converts period and clock to elapsed seconds', () => {
    expect(elapsedSecs(1, 720)).toBe(0);
    expect(elapsedSecs(2, 272)).toBe(1168);
    expect(elapsedSecs(4, 0)).toBe(2880);
    expect(elapsedSecs(5, 300)).toBe(2880);
    expect(elapsedSecs(6, 0)).toBe(3480);
  });

  it('maps elapsed seconds back; a boundary belongs to the period it ends', () => {
    expect(periodClockAt(0)).toEqual({ period: 1, clockSec: 720 });
    expect(periodClockAt(720)).toEqual({ period: 1, clockSec: 0 });
    expect(periodClockAt(721)).toEqual({ period: 2, clockSec: 719 });
    expect(periodClockAt(2880)).toEqual({ period: 4, clockSec: 0 });
    expect(periodClockAt(2990)).toEqual({ period: 5, clockSec: 190 });
  });

  it('formats clocks and game times', () => {
    expect(formatClock(272)).toBe('4:32');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(1080)).toBe('18:00');
    expect(periodName(3)).toBe('Q3');
    expect(periodName(5)).toBe('OT');
    expect(periodName(6)).toBe('2OT');
    expect(formatGameTime(1168)).toBe('Q2 4:32');
    expect(formatGameTime(2990)).toBe('OT 3:10');
    expect(formatGameTime(3240)).toBe('2OT 4:00');
  });

  it('gives the fraction of regulation left, or of the OT period in overtime', () => {
    expect(remainingFraction(1, 720)).toBe(1);
    expect(remainingFraction(3, 360)).toBeCloseTo(1080 / 2880, 10);
    expect(remainingFraction(4, 0)).toBe(0);
    expect(remainingFraction(5, 300)).toBeCloseTo(300 / 2880, 10);
  });
});

describe('winProbability (stern-v1)', () => {
  const even = { expected: 0, sigma: DEFAULT_SIGMA };

  it('a tie with no time left is a coin flip — the game goes to overtime', () => {
    expect(winProbability({ ...even, margin: 0, period: 4, clockSec: 0 })).toBe(0.5);
    expect(winProbability({ margin: 0, period: 5, clockSec: 0, expected: 6, sigma: 12 })).toBe(0.5);
  });

  it('any lead with no time left is decided', () => {
    expect(winProbability({ ...even, margin: 1, period: 4, clockSec: 0 })).toBe(1);
    expect(winProbability({ ...even, margin: -1, period: 4, clockSec: 0 })).toBe(0);
  });

  it('a big lead late approaches 1', () => {
    expect(winProbability({ ...even, margin: 15, period: 4, clockSec: 60 })).toBeGreaterThan(0.999);
  });

  it('pregame equals Φ(E / σ)', () => {
    const p = winProbability({ margin: 0, period: 1, clockSec: 720, expected: 4.5, sigma: 12.5 });
    expect(p).toBeCloseTo(normalCdf(4.5 / 12.5), 10);
    expect(p).toBeCloseTo(0.6406, 3);
  });

  it('is symmetric between the two teams', () => {
    const a = winProbability({ margin: 6, period: 3, clockSec: 300, expected: 3, sigma: 12 });
    const b = winProbability({ margin: -6, period: 3, clockSec: 300, expected: -3, sigma: 12 });
    expect(a + b).toBeCloseTo(1, 10);
  });

  it("the favorite's edge in a tie fades as time runs out", () => {
    const at = (period: number, clockSec: number) => winProbability({ margin: 0, period, clockSec, expected: 5, sigma: 12 });
    expect(at(1, 720)).toBeGreaterThan(at(4, 360));
    expect(at(4, 360)).toBeGreaterThan(0.5);
  });
});

describe('expectedLacMargin', () => {
  it('is minus the Clippers spread', () => {
    expect(expectedLacMargin(-4.5, true)).toEqual({ expected: 4.5, source: 'spread' });
    expect(expectedLacMargin(3, false)).toEqual({ expected: -3, source: 'spread' });
    expect(expectedLacMargin(0, true)).toEqual({ expected: 0, source: 'spread' });
  });

  it('falls back to home court', () => {
    expect(expectedLacMargin(null, true)).toEqual({ expected: 2.5, source: 'home_court' });
    expect(expectedLacMargin(undefined, false)).toEqual({ expected: -2.5, source: 'home_court' });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/live/win-prob.test.ts`
Expected: FAIL — cannot resolve `./win-prob`.

- [ ] **Step 4: Write the model**

Create `src/lib/live/win-prob.ts`:

```ts
// src/lib/live/win-prob.ts
// Win-probability model stern-v1 (Live v2 spec §7.1). The final LAC margin is
// Normal(m + E·r, σ²·r), so P(LAC wins) = Φ((m + E·r) / (σ·√r)): m is the
// current margin, E the pregame expected margin, r the fraction of regulation
// left (in overtime, the OT period's seconds left ÷ 2,880). A model estimate —
// σ is fitted by scripts/calibrate-wp.ts. Pure: shared by the runner, the
// calibration script and the UI.

export const PERIOD_SECS = 720;
export const OT_SECS = 300;
export const REGULATION_SECS = 4 * PERIOD_SECS;
/** Used until scripts/calibrate-wp.ts has stored a fitted σ. */
export const DEFAULT_SIGMA = 12.5;
/** Pregame expected margin when there's no spread: home court. */
export const HOME_COURT_MARGIN = 2.5;

/** Standard normal CDF via the Abramowitz–Stegun 7.1.26 erf approximation (|error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Game seconds elapsed with `clockSec` left in `period` (overtime periods are 5 minutes). */
export function elapsedSecs(period: number, clockSec: number): number {
  if (period <= 4) return (period - 1) * PERIOD_SECS + (PERIOD_SECS - clockSec);
  return REGULATION_SECS + (period - 5) * OT_SECS + (OT_SECS - clockSec);
}

/** The inverse of elapsedSecs. A boundary belongs to the period it ends (t = 720 → Q1 0:00). */
export function periodClockAt(t: number): { period: number; clockSec: number } {
  if (t <= 0) return { period: 1, clockSec: PERIOD_SECS };
  if (t <= REGULATION_SECS) {
    const period = Math.ceil(t / PERIOD_SECS);
    return { period, clockSec: period * PERIOD_SECS - t };
  }
  const ot = Math.ceil((t - REGULATION_SECS) / OT_SECS);
  return { period: 4 + ot, clockSec: REGULATION_SECS + ot * OT_SECS - t };
}

export function periodName(period: number): string {
  if (period <= 4) return `Q${period}`;
  return period === 5 ? 'OT' : `${period - 4}OT`;
}

export function formatClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Q2 4:32" for a game time in elapsed seconds. */
export function formatGameTime(t: number): string {
  const { period, clockSec } = periodClockAt(t);
  return `${periodName(period)} ${formatClock(clockSec)}`;
}

/** r in the model: regulation seconds left ÷ 2,880; in overtime, the OT period's seconds left ÷ 2,880. */
export function remainingFraction(period: number, clockSec: number): number {
  const left = period <= 4 ? (4 - period) * PERIOD_SECS + clockSec : clockSec;
  return Math.max(0, left) / REGULATION_SECS;
}

export interface WinProbInput {
  margin: number;              // LAC margin now
  period: number;
  clockSec: number;            // seconds left in the period
  expected: number;            // pregame expected LAC margin (E)
  sigma: number;
}

export function winProbability(i: WinProbInput): number {
  const r = remainingFraction(i.period, i.clockSec);
  if (r <= 0) return i.margin > 0 ? 1 : i.margin < 0 ? 0 : 0.5;
  return normalCdf((i.margin + i.expected * r) / (i.sigma * Math.sqrt(r)));
}

/** E from the Clippers' closing spread (−4.5 = favored by 4.5), else home court. */
export function expectedLacMargin(
  lacSpread: number | null | undefined,
  lacIsHome: boolean
): { expected: number; source: 'spread' | 'home_court' } {
  if (lacSpread != null && Number.isFinite(lacSpread)) return { expected: 0 - lacSpread, source: 'spread' };
  return { expected: lacIsHome ? HOME_COURT_MARGIN : -HOME_COURT_MARGIN, source: 'home_court' };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/live/win-prob.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Full verification and commit**

Run the Global Constraints verification (`npm test`, `npx tsc --noEmit -p .`, `npm run lint`, `npm run build`).

```bash
git add src/lib/types/live-state.ts src/lib/live/win-prob.ts src/lib/live/win-prob.test.ts
git commit -m "feat(live): stern-v1 win-probability model and Plan 3 state types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Calibration — fit σ, store it, check it nightly

**Files:**
- Create: `scripts/lib/wp-calibrate.ts`, `scripts/lib/wp-calibrate.test.ts`, `scripts/calibrate-wp.ts`
- Modify: `package.json` (script), `.github/workflows/post-game.yml` (nightly step)

**Interfaces:**
- Consumes: `winProbability`, `PERIOD_SECS`, `REGULATION_SECS`, `expectedLacMargin` (Task 1); `ReliabilityBin`, `WpCalibration` (Task 1).
- Produces: `WP_MODEL_KEY = 'wp:model'`, `SAMPLE_EVERY_SECS`, `SIGMA_GRID`, `BRIER_TOLERANCE = 0.005`, `CalGame`, `Sample`, `CalibrationResult`, `marginAt`, `samplesFor`, `brier`, `fitSigma`, `reliability`, `calibrate` in `scripts/lib/wp-calibrate.ts`. Task 5 imports `WP_MODEL_KEY`.

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/wp-calibrate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { brier, calibrate, fitSigma, marginAt, reliability, samplesFor, type CalGame, type Sample } from './wp-calibrate.js';

// Deterministic PRNG (mulberry32) and a Box–Muller normal draw, so the fit test is stable.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = 1 - r();
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Games that follow the model exactly: a random walk with drift E/48 and variance σ²/48 per minute. */
function simulate(n: number, sigma: number, seed: number): CalGame[] {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => {
    const expected = (r() - 0.5) * 16;
    let m = 0;
    const series: [number, number][] = [[0, 0]];
    for (let t = 60; t <= 2880; t += 60) {
      m += expected / 48 + (sigma / Math.sqrt(48)) * gauss(r);
      series.push([t, Math.round(m)]);
    }
    return { series, lacWon: m > 0, expected };
  });
}

describe('marginAt', () => {
  const series: [number, number][] = [[0, 0], [30, 2], [95, -1], [200, 4]];
  it('is the margin after the last change at or before t', () => {
    expect(marginAt(series, 0)).toBe(0);
    expect(marginAt(series, 29)).toBe(0);
    expect(marginAt(series, 30)).toBe(2);
    expect(marginAt(series, 120)).toBe(-1);
    expect(marginAt(series, 5000)).toBe(4);
    expect(marginAt([], 100)).toBe(0);
  });
});

describe('samplesFor', () => {
  it('samples every minute of regulation, from the tip', () => {
    const s = samplesFor({ series: [[0, 0], [700, 5]], lacWon: true, expected: 2 });
    expect(s).toHaveLength(48);
    expect(s[0]).toEqual({ margin: 0, period: 1, clockSec: 720, expected: 2, won: 1 });
    expect(s[12]).toEqual({ margin: 5, period: 2, clockSec: 720, expected: 2, won: 1 });
    expect(s[47]).toMatchObject({ period: 4, clockSec: 60 });
  });
});

describe('brier', () => {
  it('is ~0 for a sure thing that happened and ~1 for one that did not', () => {
    const sure: Sample = { margin: 30, period: 4, clockSec: 60, expected: 0, won: 1 };
    expect(brier([sure], 12)).toBeLessThan(1e-6);
    expect(brier([{ ...sure, won: 0 }], 12)).toBeGreaterThan(0.999);
  });
});

describe('fitSigma', () => {
  it('recovers σ from games simulated with it', () => {
    expect(Math.abs(fitSigma(simulate(1500, 12, 7).flatMap(samplesFor)).sigma - 12)).toBeLessThan(1);
    expect(Math.abs(fitSigma(simulate(1500, 15, 11).flatMap(samplesFor)).sigma - 15)).toBeLessThan(1);
  });
});

describe('reliability', () => {
  it('bins every sample by predicted probability', () => {
    const samples = simulate(200, 12, 3).flatMap(samplesFor);
    const bins = reliability(samples, 12);
    expect(bins.reduce((n, b) => n + b.n, 0)).toBe(samples.length);
    for (const b of bins) {
      expect(b.n).toBeGreaterThan(0);
      expect(b.mean_p).toBeGreaterThanOrEqual(b.lo - 1e-9);
      expect(b.mean_p).toBeLessThanOrEqual(b.hi + 1e-9);
    }
  });
});

describe('calibrate', () => {
  it('reports the fit with its sample counts', () => {
    const games = simulate(100, 12, 5);
    const r = calibrate(games);
    expect(r.n_games).toBe(100);
    expect(r.n_samples).toBe(4800);
    expect(r.sigma).toBeGreaterThanOrEqual(8);
    expect(r.sigma).toBeLessThanOrEqual(18);
    expect(r.brier).toBeGreaterThan(0);
    expect(r.reliability.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/lib/wp-calibrate.test.ts`
Expected: FAIL — cannot resolve `./wp-calibrate.js`.

- [ ] **Step 3: Write the fit**

Create `scripts/lib/wp-calibrate.ts`:

```ts
// scripts/lib/wp-calibrate.ts
// Fits σ for the stern-v1 win-probability model (Live v2 spec §7.1) by
// minimizing the Brier score over past Clippers games, sampled once a minute
// of regulation. Pure — scripts/calibrate-wp.ts does the database I/O.

import { PERIOD_SECS, REGULATION_SECS, winProbability } from '../../src/lib/live/win-prob';
import type { ReliabilityBin } from '../../src/lib/types/live-state';

/** app_kv key holding the fitted model (a WpCalibration). The runner reads it. */
export const WP_MODEL_KEY = 'wp:model';
export const SAMPLE_EVERY_SECS = 60;
export const SIGMA_GRID = { min: 8, max: 18, step: 0.1 } as const;
/** A new fit may be at most this much worse (Brier) than the stored one. */
export const BRIER_TOLERANCE = 0.005;

export interface CalGame {
  series: [number, number][];  // [elapsed_sec, lac_margin], ascending (game_flow.margin_series)
  lacWon: boolean;
  expected: number;            // pregame expected LAC margin
}

export interface Sample {
  margin: number;
  period: number;
  clockSec: number;
  expected: number;
  won: 0 | 1;
}

export interface CalibrationResult {
  sigma: number;
  brier: number;
  n_games: number;
  n_samples: number;
  reliability: ReliabilityBin[];
}

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

/** The LAC margin after the last change at or before t. */
export function marginAt(series: [number, number][], t: number): number {
  let m = 0;
  for (const [at, margin] of series) {
    if (at > t) break;
    m = margin;
  }
  return m;
}

export function samplesFor(g: CalGame): Sample[] {
  const out: Sample[] = [];
  for (let t = 0; t < REGULATION_SECS; t += SAMPLE_EVERY_SECS) {
    const period = Math.floor(t / PERIOD_SECS) + 1;
    out.push({ margin: marginAt(g.series, t), period, clockSec: period * PERIOD_SECS - t, expected: g.expected, won: g.lacWon ? 1 : 0 });
  }
  return out;
}

function prob(s: Sample, sigma: number): number {
  return winProbability({ margin: s.margin, period: s.period, clockSec: s.clockSec, expected: s.expected, sigma });
}

export function brier(samples: Sample[], sigma: number): number {
  if (samples.length === 0) return NaN;
  let sum = 0;
  for (const s of samples) {
    const d = prob(s, sigma) - s.won;
    sum += d * d;
  }
  return sum / samples.length;
}

export function fitSigma(
  samples: Sample[],
  grid: { min: number; max: number; step: number } = SIGMA_GRID
): { sigma: number; brier: number } {
  let best = { sigma: grid.min, brier: Infinity };
  const steps = Math.round((grid.max - grid.min) / grid.step);
  for (let k = 0; k <= steps; k++) {
    const sigma = round(grid.min + k * grid.step, 3);
    const b = brier(samples, sigma);
    if (b < best.brier) best = { sigma, brier: b };
  }
  return best;
}

export function reliability(samples: Sample[], sigma: number, bins = 10): ReliabilityBin[] {
  const acc = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, sumP: 0, wins: 0 }));
  for (const s of samples) {
    const p = prob(s, sigma);
    const b = acc[Math.min(bins - 1, Math.floor(p * bins))];
    b.n += 1;
    b.sumP += p;
    b.wins += s.won;
  }
  return acc
    .filter((b) => b.n > 0)
    .map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, mean_p: round(b.sumP / b.n, 3), observed: round(b.wins / b.n, 3) }));
}

export function calibrate(games: CalGame[]): CalibrationResult {
  const samples = games.flatMap(samplesFor);
  const fit = fitSigma(samples);
  return {
    sigma: fit.sigma,
    brier: round(fit.brier, 5),
    n_games: games.length,
    n_samples: samples.length,
    reliability: reliability(samples, fit.sigma),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run scripts/lib/wp-calibrate.test.ts`
Expected: PASS. (The two σ-recovery fits take about a second each.)

- [ ] **Step 5: Write the CLI**

Create `scripts/calibrate-wp.ts`:

```ts
// scripts/calibrate-wp.ts
// Fits the stern-v1 win-probability σ over every final Clippers game with a
// game_flow margin series (Live v2 spec §7.1, §10) and stores it in app_kv
// ('wp:model'); the game-night runner reads it at start. Refuses to store a fit
// whose Brier score is worse than the stored one by more than 0.005 (exit 1),
// which is what makes the nightly post-game run go red on a regression.
//
//   npm run calibrate-wp            fit, print, store
//   npm run calibrate-wp -- --dry   fit and print only

import { sql } from './lib/db.js';
import { BRIER_TOLERANCE, calibrate, WP_MODEL_KEY, type CalGame } from './lib/wp-calibrate.js';
import { expectedLacMargin } from '../src/lib/live/win-prob.js';
import type { WpCalibration } from '../src/lib/types/live-state.js';

const MIN_GAMES = 50;
type Json = Parameters<typeof sql.json>[0];

interface Row {
  series: [number, number][];
  lac_home: boolean;
  home_score: number;
  away_score: number;
  lac_spread: number | null;
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const rows = await sql<Row[]>`
    SELECT
      gf.margin_series                   AS series,
      (g.home_team_id = lac.team_id)     AS lac_home,
      g.home_score,
      g.away_score,
      (SELECT (CASE WHEN g.home_team_id = lac.team_id THEN o.spread_home ELSE o.spread_away END)::float8
         FROM odds_snapshots o
        WHERE o.game_id = g.game_id
          AND (g.start_time_utc IS NULL OR o.captured_at <= g.start_time_utc)
        ORDER BY o.captured_at DESC
        LIMIT 1)                         AS lac_spread
    FROM game_flow gf
    JOIN games g ON g.game_id = gf.game_id
    JOIN teams lac ON lac.abbreviation = 'LAC'
    WHERE lower(g.status) = 'final'
      AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
      AND (g.home_team_id = lac.team_id OR g.away_team_id = lac.team_id)
  `;

  const games: CalGame[] = rows
    .filter((r) => Array.isArray(r.series) && r.home_score !== r.away_score)
    .map((r) => ({
      series: r.series,
      lacWon: r.lac_home ? r.home_score > r.away_score : r.away_score > r.home_score,
      expected: expectedLacMargin(r.lac_spread, r.lac_home).expected,
    }));
  if (games.length < MIN_GAMES) {
    console.error(`[calibrate-wp] Only ${games.length} games with a margin series; need ${MIN_GAMES}. Not fitting.`);
    process.exitCode = 1;
    return;
  }

  const result = calibrate(games);
  const withSpread = rows.filter((r) => r.lac_spread !== null).length;
  console.log(
    `[calibrate-wp] ${result.n_games} games (${withSpread} with a closing spread), ${result.n_samples} samples → ` +
      `σ ${result.sigma}, Brier ${result.brier}`
  );
  console.log('  predicted     actual   n');
  for (const b of result.reliability) {
    console.log(`  ${b.lo.toFixed(1)}–${b.hi.toFixed(1)}  ${b.mean_p.toFixed(3)}  ${b.observed.toFixed(3)}  ${b.n}`);
  }

  const [stored] = await sql<{ value: WpCalibration }[]>`SELECT value FROM app_kv WHERE key = ${WP_MODEL_KEY}`;
  if (stored && result.brier > stored.value.brier + BRIER_TOLERANCE) {
    console.error(
      `[calibrate-wp] Brier ${result.brier} is worse than the stored ${stored.value.brier} by more than ${BRIER_TOLERANCE}. ` +
        'Keeping the stored model.'
    );
    process.exitCode = 1;
    return;
  }
  if (dry) {
    console.log('[calibrate-wp] --dry: not storing.');
    return;
  }

  const value: WpCalibration = { ...result, fitted_at: new Date().toISOString() };
  await sql`
    INSERT INTO app_kv (key, value, updated_at)
    VALUES (${WP_MODEL_KEY}, ${sql.json(value as unknown as Json)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  console.log(`[calibrate-wp] Stored ${WP_MODEL_KEY}.`);
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error('[calibrate-wp] Failed:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
```

- [ ] **Step 6: Add the npm script and the nightly step**

In `package.json` `scripts`, after `"sync-media"`, add:

```json
    "calibrate-wp": "node --env-file-if-exists=.env.local node_modules/.bin/tsx scripts/calibrate-wp.ts",
```

In `.github/workflows/post-game.yml`, append as the **last** step of the `post-game` job (after "Verify insight proofs", matching its indentation):

```yaml
      # Refit the live win-probability model with last night's games (Live v2
      # spec §7.1). Exits 1 — a red run — if the fit got worse by more than
      # 0.005 Brier; the stored model is kept.
      - name: Calibrate win probability
        run: npm run calibrate-wp
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

Validate the YAML parses: `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/post-game.yml','utf8'))" 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/post-game.yml'))"` — use whichever parser is installed locally; do not install one. Expected: no output, exit 0.

- [ ] **Step 7: Full verification and commit**

Run the Global Constraints verification. `scripts/calibrate-wp.ts` is not run here — it needs the production database (Task 12).

```bash
git add scripts/lib/wp-calibrate.ts scripts/lib/wp-calibrate.test.ts scripts/calibrate-wp.ts package.json .github/workflows/post-game.yml
git commit -m "feat(live): calibrate the win-probability model over past Clippers games

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Game-flow series and markers

**Files:**
- Create: `scripts/lib/live-flow.ts`, `scripts/lib/live-flow.test.ts`

**Interfaces:**
- Consumes: `elapsedSecs`, `PERIOD_SECS`, `winProbability` (Task 1); `FlowMarker`, `FlowPoint`, `LiveFlow` (Task 1); `clockToSecondsRemaining` (`scripts/lib/nba-live-client.ts`); `LAC_TEAM_ID` (`scripts/lib/poll-live-logic.ts`, = 1610612746).
- Produces: `buildFlow(actions: PlayByPlayAction[], lacIsHome: boolean, model: FlowModel): LiveFlow`, `FlowModel = { expected: number; sigma: number }`, `RUN_MARKER_MIN = 8`. Task 5 calls `buildFlow`.

`live-flow.ts` is imported by `live-state.ts`, which the cron route bundles: **suffix-less imports**.

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/live-flow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFlow, RUN_MARKER_MIN } from './live-flow.js';
import { action, LAC_ID, SAC_ID } from './live-fixtures.js';
import { normalCdf, winProbability } from '../../src/lib/live/win-prob.js';
import type { PlayByPlayAction } from '../../src/lib/types/live.js';

const EVEN = { expected: 0, sigma: 12.5 };

/** A scoring action that leaves the score at home–away (LAC is home unless stated). */
function score(n: number, home: number, away: number, clock: string, period = 1, teamId = LAC_ID): PlayByPlayAction {
  return action(n, {
    scoreHome: String(home),
    scoreAway: String(away),
    clock,
    period,
    teamId,
    teamTricode: teamId === LAC_ID ? 'LAC' : 'SAC',
    description: `Score ${home}-${away}`,
  });
}

describe('buildFlow', () => {
  it('starts at the tip with the pregame win probability', () => {
    const flow = buildFlow([], true, { expected: 4.5, sigma: 12.5 });
    expect(flow.markers).toEqual([]);
    expect(flow.points).toHaveLength(1);
    expect(flow.points[0]).toMatchObject({ t: 0, m: 0, a: 0, d: '' });
    expect(flow.points[0].wp).toBeCloseTo(normalCdf(4.5 / 12.5), 3);
  });

  it('adds a point per score change, from the Clippers side', () => {
    const actions = [
      score(1, 2, 0, 'PT11M30.00S'),
      action(2, { actionType: 'rebound', subType: 'defensive', scoreHome: '2', scoreAway: '0', clock: 'PT11M00.00S' }),
      score(3, 2, 3, 'PT10M40.00S', 1, SAC_ID),
    ];
    const home = buildFlow(actions, true, EVEN).points;
    expect(home.map((p) => [p.t, p.m, p.a])).toEqual([[0, 0, 0], [30, 2, 1], [80, -1, 3]]);
    expect(home[1].d).toBe('Score 2-0');
    expect(home[1].wp).toBeCloseTo(winProbability({ margin: 2, period: 1, clockSec: 690, ...EVEN }), 3);

    const away = buildFlow(actions, false, EVEN).points;
    expect(away.map((p) => p.m)).toEqual([0, -2, 1]);
  });

  it('skips actions without a readable score', () => {
    const flow = buildFlow([action(1, { scoreHome: '', scoreAway: '' }), score(2, 3, 0, 'PT11M00.00S')], true, EVEN);
    expect(flow.points.map((p) => p.a)).toEqual([0, 2]);
  });

  it(`marks a run of ${RUN_MARKER_MIN} or more unanswered points, not a shorter one`, () => {
    const flow = buildFlow(
      [
        score(1, 2, 0, 'PT11M00.00S'),
        score(2, 5, 0, 'PT10M30.00S'),
        score(3, 8, 0, 'PT10M00.00S'),
        score(4, 8, 2, 'PT09M30.00S', 1, SAC_ID),
        score(5, 8, 5, 'PT09M00.00S', 1, SAC_ID),
        score(6, 10, 5, 'PT08M30.00S'),
      ],
      true,
      EVEN
    );
    const runs = flow.markers.filter((m) => m.kind === 'run');
    expect(runs).toEqual([{ kind: 'run', t: 120, t_start: 60, side: 'lac', pts: 8 }]);
  });

  it('marks a run that is still going', () => {
    const flow = buildFlow(
      [score(1, 0, 3, 'PT11M00.00S', 1, SAC_ID), score(2, 0, 6, 'PT10M00.00S', 1, SAC_ID), score(3, 0, 9, 'PT09M00.00S', 1, SAC_ID)],
      true,
      EVEN
    );
    expect(flow.markers).toContainEqual({ kind: 'run', t: 180, t_start: 60, side: 'opp', pts: 9 });
  });

  it('marks lead changes, not ties', () => {
    const flow = buildFlow(
      [
        score(1, 2, 0, 'PT11M00.00S'),
        score(2, 2, 2, 'PT10M00.00S', 1, SAC_ID),
        score(3, 2, 4, 'PT09M00.00S', 1, SAC_ID),
        score(4, 5, 4, 'PT08M00.00S'),
      ],
      true,
      EVEN
    );
    expect(flow.markers.filter((m) => m.kind === 'lead_change')).toEqual([
      { kind: 'lead_change', t: 180, side: 'opp' },
      { kind: 'lead_change', t: 240, side: 'lac' },
    ]);
  });

  it('marks team timeouts and skips official ones', () => {
    const flow = buildFlow(
      [
        action(1, { actionType: 'timeout', subType: 'full', teamId: SAC_ID, teamTricode: 'SAC', clock: 'PT06M00.00S' }),
        action(2, { actionType: 'timeout', subType: 'official', teamId: 0, teamTricode: '', clock: 'PT05M00.00S' }),
      ],
      true,
      EVEN
    );
    expect(flow.markers).toEqual([{ kind: 'timeout', t: 360, side: 'opp' }]);
  });

  it('closes each period with a point at its buzzer', () => {
    const flow = buildFlow(
      [score(1, 2, 0, 'PT05M00.00S'), action(2, { actionType: 'period', subType: 'end', clock: 'PT00M00.00S', scoreHome: '2', scoreAway: '0' })],
      true,
      EVEN
    );
    expect(flow.markers).toContainEqual({ kind: 'period_end', t: 720, period: 1 });
    expect(flow.points.at(-1)).toMatchObject({ t: 720, m: 2, a: 2, d: '' });
  });

  it('marks the largest lead each way', () => {
    const flow = buildFlow(
      [score(1, 5, 0, 'PT11M00.00S'), score(2, 5, 9, 'PT09M00.00S', 1, SAC_ID), score(3, 7, 9, 'PT08M00.00S')],
      true,
      EVEN
    );
    expect(flow.markers).toContainEqual({ kind: 'max_lead', t: 60, side: 'lac', margin: 5 });
    expect(flow.markers).toContainEqual({ kind: 'max_lead', t: 180, side: 'opp', margin: 4 });
  });

  it('keeps markers in time order', () => {
    const flow = buildFlow(
      [
        score(1, 3, 0, 'PT11M00.00S'),
        action(2, { actionType: 'timeout', subType: 'full', teamId: SAC_ID, clock: 'PT10M50.00S' }),
        score(3, 3, 5, 'PT10M00.00S', 1, SAC_ID),
      ],
      true,
      EVEN
    );
    const ts = flow.markers.map((m) => m.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('only appends points as the feed grows', () => {
    const actions: PlayByPlayAction[] = [];
    let home = 0;
    let away = 0;
    for (let n = 1; n <= 40; n++) {
      if (n % 3 === 0) away += 2;
      else home += n % 2 ? 3 : 1;
      actions.push(score(n, home, away, `PT${String(11 - Math.floor(n / 4)).padStart(2, '0')}M00.00S`, 1, n % 3 === 0 ? SAC_ID : LAC_ID));
    }
    const full = buildFlow(actions, true, EVEN).points;
    for (let k = 0; k <= actions.length; k++) {
      const part = buildFlow(actions.slice(0, k), true, EVEN).points;
      expect(full.slice(0, part.length)).toEqual(part);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/lib/live-flow.test.ts`
Expected: FAIL — cannot resolve `./live-flow.js`.

- [ ] **Step 3: Write the derivation**

Create `scripts/lib/live-flow.ts`:

```ts
// scripts/lib/live-flow.ts
// The game-flow series and markers behind /live's flow chart (Live v2 spec
// §7.1), from the raw play-by-play: one point per score change plus the tip
// and each period's buzzer, each with the LAC margin and the model's win
// probability at that moment. Markers: runs of 8+ unanswered points, team
// timeouts, lead changes, period ends and the largest lead each way. Pure; the
// points only grow as long as the feed only appends actions.

import type { PlayByPlayAction } from '../../src/lib/types/live';
import type { FlowMarker, FlowPoint, LiveFlow } from '../../src/lib/types/live-state';
import { elapsedSecs, PERIOD_SECS, winProbability } from '../../src/lib/live/win-prob';
import { clockToSecondsRemaining } from './nba-live-client';
import { LAC_TEAM_ID } from './poll-live-logic';

/** Same threshold as detectScoringRun in src/lib/insights/live.ts. */
export const RUN_MARKER_MIN = 8;

export interface FlowModel {
  expected: number;            // pregame expected LAC margin
  sigma: number;
}

type Side = 'lac' | 'opp';

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function buildFlow(actions: PlayByPlayAction[], lacIsHome: boolean, model: FlowModel): LiveFlow {
  const wp = (margin: number, period: number, clockSec: number) =>
    round3(winProbability({ margin, period, clockSec, expected: model.expected, sigma: model.sigma }));

  const points: FlowPoint[] = [{ t: 0, m: 0, wp: wp(0, 1, PERIOD_SECS), a: 0, d: '' }];
  const markers: FlowMarker[] = [];
  let home = 0;
  let away = 0;
  let margin = 0;
  let lastSign = 0;
  let run: { side: Side; pts: number; t_start: number; t: number } | null = null;
  const lead = { lac: { margin: 0, t: 0 }, opp: { margin: 0, t: 0 } };

  const endRun = () => {
    if (run && run.pts >= RUN_MARKER_MIN) {
      markers.push({ kind: 'run', t: run.t, t_start: run.t_start, side: run.side, pts: run.pts });
    }
    run = null;
  };
  const extendRun = (side: Side, pts: number, t: number) => {
    if (run && run.side === side) {
      run.pts += pts;
      run.t = t;
    } else {
      endRun();
      run = { side, pts, t_start: t, t };
    }
  };

  for (const a of actions) {
    const type = a.actionType.toLowerCase();
    const sub = (a.subType ?? '').toLowerCase();
    const clockSec = clockToSecondsRemaining(a.clock);
    const t = elapsedSecs(a.period, clockSec);

    if (type === 'timeout') {
      // Official (media) timeouts carry no team.
      if (a.teamId) markers.push({ kind: 'timeout', t, side: a.teamId === LAC_TEAM_ID ? 'lac' : 'opp' });
      continue;
    }
    if (type === 'period' && sub === 'end') {
      markers.push({ kind: 'period_end', t, period: a.period });
      points.push({ t, m: margin, wp: wp(margin, a.period, 0), a: a.actionNumber, d: '' });
      continue;
    }

    const h = parseInt(a.scoreHome, 10);
    const w = parseInt(a.scoreAway, 10);
    if (!Number.isFinite(h) || !Number.isFinite(w) || (h === home && w === away)) continue;
    const dLac = lacIsHome ? h - home : w - away;
    const dOpp = lacIsHome ? w - away : h - home;
    home = h;
    away = w;

    if (dLac > 0 && dOpp === 0) extendRun('lac', dLac, t);
    else if (dOpp > 0 && dLac === 0) extendRun('opp', dOpp, t);
    else endRun(); // a score correction breaks any run

    const m = lacIsHome ? h - w : w - h;
    const sign = Math.sign(m);
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) {
      markers.push({ kind: 'lead_change', t, side: sign > 0 ? 'lac' : 'opp' });
    }
    if (sign !== 0) lastSign = sign;
    margin = m;
    if (m > lead.lac.margin) lead.lac = { margin: m, t };
    if (-m > lead.opp.margin) lead.opp = { margin: -m, t };

    points.push({ t, m, wp: wp(m, a.period, clockSec), a: a.actionNumber, d: a.description ?? '' });
  }
  endRun();

  if (lead.lac.margin > 0) markers.push({ kind: 'max_lead', t: lead.lac.t, side: 'lac', margin: lead.lac.margin });
  if (lead.opp.margin > 0) markers.push({ kind: 'max_lead', t: lead.opp.t, side: 'opp', margin: lead.opp.margin });
  markers.sort((x, y) => x.t - y.t); // stable: same-time markers keep their order

  return { points, markers };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run scripts/lib/live-flow.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Full verification and commit**

Run the Global Constraints verification.

```bash
git add scripts/lib/live-flow.ts scripts/lib/live-flow.test.ts
git commit -m "feat(live): game-flow series and markers from play-by-play

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rotation clipboard — stints, fouls, minutes, units

**Files:**
- Modify: `src/lib/types/live.ts` (`BoxscoreTeam`)
- Create: `scripts/lib/live-lineups.ts`, `scripts/lib/live-lineups.test.ts`

**Interfaces:**
- Consumes: `elapsedSecs`, `PERIOD_SECS`, `OT_SECS`, `REGULATION_SECS` (Task 1); `LineupState`, `LineupUnit`, `StintPlayer` (Task 1); `clockToSecondsRemaining`, `parseNBAClock` (`scripts/lib/nba-live-client.ts`).
- Produces: `buildLineups(i: LineupInputs): LineupState`, `LineupInputs`, `inFoulTrouble(period, fouls)`, `minutesPace(min, usual, elapsed)`, `isoMinutes(iso)`, `UNITS_SHOWN = 5`, `PACE_FLAG_RATIO = 0.25`, `PACE_MIN_ELAPSED_SECS = 720`. Task 5 calls `buildLineups`.

`live-lineups.ts` is bundled through `live-state.ts`: **suffix-less imports**.

- [ ] **Step 1: Let the box score carry timeouts and bonus**

The CDN box score's team objects include `timeoutsRemaining` and `inBonus` (the scoreboard has the same fields). In `src/lib/types/live.ts`, add to `BoxscoreTeam` after `players`:

```ts
  timeoutsRemaining?: number; // the CDN box score has these; the stats.nba.com fallback doesn't
  inBonus?: string;           // "1" | "0"
```

- [ ] **Step 2: Write the failing test**

Create `scripts/lib/live-lineups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildLineups, inFoulTrouble, isoMinutes, minutesPace, type LineupInputs } from './live-lineups.js';
import { action, box, LAC_ID, SAC_ID } from './live-fixtures.js';
import type { BoxscorePlayer, BoxscoreTeam, PlayByPlayAction, PlayerStatistics } from '../../src/lib/types/live.js';

const ZERO: PlayerStatistics = {
  assists: 0, blocks: 0, fieldGoalsAttempted: 0, fieldGoalsMade: 0, fieldGoalsPercentage: 0, foulsPersonal: 0,
  freeThrowsAttempted: 0, freeThrowsMade: 0, freeThrowsPercentage: 0, minutes: 'PT00M00.00S', minutesCalculated: 'PT00M',
  plus: 0, minus: 0, plusMinusPoints: 0, points: 0, reboundsDefensive: 0, reboundsOffensive: 0, reboundsTotal: 0,
  steals: 0, threePointersAttempted: 0, threePointersMade: 0, threePointersPercentage: 0, turnovers: 0,
};

function player(personId: number, o: { on?: boolean; starter?: boolean; pf?: number; minutes?: string } = {}): BoxscorePlayer {
  return {
    status: 'ACTIVE', order: 1, personId, jerseyNum: '0', name: `Player ${personId}`, nameI: `P. ${personId}`, position: '',
    starter: o.starter ? '1' : '0', oncourt: o.on ? '1' : '0', played: '1',
    statistics: { ...ZERO, foulsPersonal: o.pf ?? 0, minutes: o.minutes ?? 'PT00M00.00S' },
  };
}

/** LAC: starters 101–105, bench 106. `on` lists who is on the floor now. */
function lac(on: number[], extra: Partial<BoxscoreTeam> = {}): BoxscoreTeam {
  const players = [101, 102, 103, 104, 105, 106].map((id) => player(id, { on: on.includes(id), starter: id <= 105 }));
  return { ...box().homeTeam, players, ...extra };
}

function sac(): BoxscoreTeam {
  return { ...box().awayTeam, players: [201, 202, 203, 204, 205].map((id) => player(id, { on: true, starter: true })) };
}

function score(n: number, home: number, away: number, clock: string, period = 1): PlayByPlayAction {
  return action(n, { scoreHome: String(home), scoreAway: String(away), clock, period });
}

function sub(n: number, personId: number, dir: 'in' | 'out', clock: string, period: number, home: number, away: number): PlayByPlayAction {
  return action(n, { actionType: 'substitution', subType: dir, personId, teamId: LAC_ID, clock, period, scoreHome: String(home), scoreAway: String(away) });
}

function inputs(over: Partial<LineupInputs>): LineupInputs {
  return { actions: [], lacBox: lac([101, 102, 103, 104, 105]), oppBox: sac(), lacIsHome: true, period: 1, clockSec: 720, usualMin: {}, ...over };
}

describe('inFoulTrouble', () => {
  it('uses 2 / 3 / 4 / 5 fouls by quarter', () => {
    expect(inFoulTrouble(1, 1)).toBe(false);
    expect(inFoulTrouble(1, 2)).toBe(true);
    expect(inFoulTrouble(2, 3)).toBe(true);
    expect(inFoulTrouble(3, 3)).toBe(false);
    expect(inFoulTrouble(3, 4)).toBe(true);
    expect(inFoulTrouble(4, 5)).toBe(true);
    expect(inFoulTrouble(5, 4)).toBe(false);
    expect(inFoulTrouble(6, 5)).toBe(true);
  });
});

describe('minutesPace', () => {
  it('flags projected minutes more than 25 % off the usual', () => {
    expect(minutesPace(20, 30, 1440)).toBe('over');   // on pace for 40
    expect(minutesPace(8, 30, 1440)).toBe('under');   // on pace for 16
    expect(minutesPace(15, 30, 1440)).toBeNull();     // on pace for 30
  });
  it('does not judge the first quarter or a player without a usual', () => {
    expect(minutesPace(10, 30, 600)).toBeNull();
    expect(minutesPace(10, null, 1440)).toBeNull();
  });
});

describe('isoMinutes', () => {
  it('reads the box score minutes', () => {
    expect(isoMinutes('PT25M30.00S')).toBe(25.5);
    expect(isoMinutes('')).toBe(0);
  });
});

describe('buildLineups', () => {
  // Q1 11:00 LAC 2-0; Q2 6:00 105 out, 106 in at 10-8; Q2 2:00 now 15-8.
  const midQ2 = inputs({
    actions: [
      score(1, 2, 0, 'PT11M00.00S'),
      sub(2, 105, 'out', 'PT06M00.00S', 2, 10, 8),
      sub(3, 106, 'in', 'PT06M00.00S', 2, 10, 8),
      score(4, 15, 8, 'PT02M00.00S', 2),
    ],
    lacBox: lac([101, 102, 103, 104, 106]),
    period: 2,
    clockSec: 120,
  });

  it('times a stint from the substitution that started it', () => {
    const l = buildLineups(midQ2);
    const bench = l.on_court.lac.find((p) => p.player_id === 106)!;
    expect(bench).toMatchObject({ stint_start: { period: 2, clock: '6:00' }, stint_secs: 240, stint_plus_minus: 5 });
    const starter = l.on_court.lac.find((p) => p.player_id === 101)!;
    expect(starter).toMatchObject({ stint_start: { period: 1, clock: '12:00' }, stint_secs: 1320, stint_plus_minus: 7 });
    expect(l.on_court.lac.map((p) => p.player_id)).not.toContain(105);
  });

  it("gives the other team's stints from their side", () => {
    const l = buildLineups(midQ2);
    expect(l.on_court.opp).toHaveLength(5);
    expect(l.on_court.opp[0]).toMatchObject({ stint_secs: 1320, stint_plus_minus: -7 });
  });

  it('times the current Clippers five from its newest arrival', () => {
    expect(buildLineups(midQ2).current_unit).toEqual({ secs_together: 240, lac_plus_minus: 5 });
  });

  it("tallies tonight's Clippers units, longest first", () => {
    const units = buildLineups(midQ2).units_tonight;
    expect(units.map((u) => [u.player_ids, u.secs, u.plus_minus])).toEqual([
      [[101, 102, 103, 104, 105], 1080, 2],
      [[101, 102, 103, 104, 106], 240, 5],
    ]);
    expect(units[1].names).toEqual(['P. 101', 'P. 102', 'P. 103', 'P. 104', 'P. 106']);
  });

  it('treats a player back on the floor without a logged sub as back since the period started', () => {
    const l = buildLineups(
      inputs({
        actions: [
          sub(1, 105, 'out', 'PT05M00.00S', 1, 4, 4),
          sub(2, 106, 'in', 'PT05M00.00S', 1, 4, 4),
          score(3, 12, 9, 'PT00M30.00S', 1),
          score(4, 14, 9, 'PT11M00.00S', 2),
        ],
        lacBox: lac([101, 102, 103, 104, 105]),
        period: 2,
        clockSec: 660,
      })
    );
    expect(l.on_court.lac.find((p) => p.player_id === 105)).toMatchObject({
      stint_start: { period: 2, clock: '12:00' },
      stint_secs: 60,
      stint_plus_minus: 2,
    });
  });

  it('flags foul trouble and minutes pace', () => {
    const team = lac([101, 102, 103, 104, 105]);
    team.players[0] = { ...team.players[0], statistics: { ...team.players[0].statistics, foulsPersonal: 3, minutes: 'PT20M00.00S' } };
    const l = buildLineups(inputs({ lacBox: team, period: 2, clockSec: 0, usualMin: { '101': 30 } }));
    expect(l.on_court.lac[0]).toMatchObject({ pf: 3, foul_trouble: true, min: 20, usual_min: 30, pace: 'over' });
    expect(l.on_court.lac[1]).toMatchObject({ foul_trouble: false, usual_min: null, pace: null });
  });

  it('reads timeouts and bonus from the box, else from the scoreboard fallback', () => {
    const l = buildLineups(
      inputs({
        lacBox: lac([101, 102, 103, 104, 105], { timeoutsRemaining: 4, inBonus: '1' }),
        fallback: { timeouts: { lac: 7, opp: 3 }, bonus: { lac: false, opp: false } },
      })
    );
    expect(l.timeouts).toEqual({ lac: 4, opp: 3 });
    expect(l.bonus).toEqual({ lac: true, opp: false });
  });

  it('works from the away side', () => {
    const l = buildLineups(
      inputs({
        actions: [score(1, 0, 3, 'PT11M00.00S')],
        lacBox: { ...lac([101, 102, 103, 104, 105]), teamId: LAC_ID },
        oppBox: { ...sac(), teamId: SAC_ID },
        lacIsHome: false,
        period: 1,
        clockSec: 600,
      })
    );
    expect(l.on_court.lac[0].stint_plus_minus).toBe(3);
    expect(l.current_unit.lac_plus_minus).toBe(3);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run scripts/lib/live-lineups.test.ts`
Expected: FAIL — cannot resolve `./live-lineups.js`.

- [ ] **Step 4: Write the derivation**

Create `scripts/lib/live-lineups.ts`:

```ts
// scripts/lib/live-lineups.ts
// The rotation clipboard (Live v2 spec §7.2): who is on the floor and for how
// long, each stint's +/-, foul trouble, minutes against the player's usual,
// and tonight's Clippers five-man units. On-court players come from the box
// score (`oncourt`); stint starts and units from play-by-play substitutions.
// The feed doesn't always log substitutions between periods: a player on the
// floor whose last logged substitution was "out" counts as back since the next
// period started. Pure.

import type { BoxscorePlayer, BoxscoreTeam, PlayByPlayAction } from '../../src/lib/types/live';
import type { LineupState, LineupUnit, StintPlayer } from '../../src/lib/types/live-state';
import { elapsedSecs, OT_SECS, PERIOD_SECS, REGULATION_SECS } from '../../src/lib/live/win-prob';
import { clockToSecondsRemaining, parseNBAClock } from './nba-live-client';

export const UNITS_SHOWN = 5;
/** Projected minutes this far off the usual are flagged. */
export const PACE_FLAG_RATIO = 0.25;
/** Minutes pace isn't judged before this much game time. */
export const PACE_MIN_ELAPSED_SECS = PERIOD_SECS;

export interface LineupInputs {
  actions: PlayByPlayAction[];
  lacBox: BoxscoreTeam;
  oppBox: BoxscoreTeam;
  lacIsHome: boolean;
  period: number;              // game clock now
  clockSec: number;
  usualMin: Record<string, number>; // NBA personId → last-10-game average minutes
  /** Scoreboard values, for a box score without timeouts/bonus. */
  fallback?: { timeouts: { lac: number | null; opp: number | null }; bonus: { lac: boolean; opp: boolean } };
}

/** 2 fouls in Q1, 3 in Q2, 4 in Q3, 5 in Q4 and overtime. */
export function inFoulTrouble(period: number, fouls: number): boolean {
  const limit = period <= 1 ? 2 : period === 2 ? 3 : period === 3 ? 4 : 5;
  return fouls >= limit;
}

/** "PT25M30.00S" → 25.5 */
export function isoMinutes(iso: string): number {
  const m = /PT(?:(\d+)M)?(?:([\d.]+)S)?/.exec(iso ?? '');
  if (!m || (!m[1] && !m[2])) return 0;
  return Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60;
}

export function minutesPace(min: number, usual: number | null, elapsed: number): 'over' | 'under' | null {
  if (usual === null || usual <= 0 || elapsed < PACE_MIN_ELAPSED_SECS) return null;
  const ratio = (min * REGULATION_SECS) / elapsed / usual;
  return ratio > 1 + PACE_FLAG_RATIO ? 'over' : ratio < 1 - PACE_FLAG_RATIO ? 'under' : null;
}

interface Timeline {
  t: number[];                 // elapsed secs of each action
  margin: number[];            // LAC margin after each action
}

interface Stint {
  t: number;
  margin: number;              // LAC margin when it started
  period: number;
  clock: string;
}

function timeline(actions: PlayByPlayAction[], lacIsHome: boolean): Timeline {
  const t: number[] = [];
  const margin: number[] = [];
  let m = 0;
  for (const a of actions) {
    t.push(elapsedSecs(a.period, clockToSecondsRemaining(a.clock)));
    const h = parseInt(a.scoreHome, 10);
    const w = parseInt(a.scoreAway, 10);
    if (Number.isFinite(h) && Number.isFinite(w)) m = lacIsHome ? h - w : w - h;
    margin.push(m);
  }
  return { t, margin };
}

function marginAt(tl: Timeline, at: number): number {
  let m = 0;
  for (let i = 0; i < tl.t.length && tl.t[i] <= at; i++) m = tl.margin[i];
  return m;
}

function periodStart(period: number): number {
  return period <= 4 ? (period - 1) * PERIOD_SECS : REGULATION_SECS + (period - 5) * OT_SECS;
}

const isSub = (a: PlayByPlayAction, teamId: number) => a.actionType.toLowerCase() === 'substitution' && a.teamId === teamId;
const shortName = (p: BoxscorePlayer) => p.nameI || p.name;
const round1 = (x: number) => Math.round(x * 10) / 10;

function stintStart(personId: number, team: BoxscoreTeam, i: LineupInputs, tl: Timeline): Stint {
  let lastIn = -1;
  let lastOut = -1;
  i.actions.forEach((a, idx) => {
    if (a.personId !== personId || !isSub(a, team.teamId)) return;
    const dir = (a.subType ?? '').toLowerCase();
    if (dir === 'in') lastIn = idx;
    else if (dir === 'out') lastOut = idx;
  });
  if (lastIn > lastOut) {
    const a = i.actions[lastIn];
    return { t: tl.t[lastIn], margin: tl.margin[lastIn], period: a.period, clock: parseNBAClock(a.clock) };
  }
  if (lastOut >= 0) {
    const period = Math.min(i.actions[lastOut].period + 1, i.period);
    const t = periodStart(period);
    return { t, margin: marginAt(tl, t), period, clock: period <= 4 ? '12:00' : '5:00' };
  }
  return { t: 0, margin: 0, period: 1, clock: '12:00' };
}

function unitsTonight(i: LineupInputs, tl: Timeline, now: number, marginNow: number): LineupUnit[] {
  const team = i.lacBox;
  const names = new Map(team.players.map((p) => [p.personId, shortName(p)]));
  const unit = new Set(team.players.filter((p) => p.starter === '1').map((p) => p.personId));
  const acc = new Map<string, LineupUnit>();
  let since = 0;
  let sinceMargin = 0;
  const close = (t: number, margin: number) => {
    if (unit.size === 5 && t > since) {
      const ids = [...unit].sort((a, b) => a - b);
      const key = ids.join('-');
      const u = acc.get(key) ?? { player_ids: ids, names: ids.map((id) => names.get(id) ?? String(id)), secs: 0, plus_minus: 0 };
      u.secs += t - since;
      u.plus_minus += margin - sinceMargin;
      acc.set(key, u);
    }
    since = t;
    sinceMargin = margin;
  };
  i.actions.forEach((a, idx) => {
    if (!isSub(a, team.teamId) || !a.personId) return;
    close(tl.t[idx], tl.margin[idx]);
    const dir = (a.subType ?? '').toLowerCase();
    if (dir === 'in') unit.add(a.personId);
    else if (dir === 'out') unit.delete(a.personId);
  });
  close(now, marginNow);
  return [...acc.values()].sort((a, b) => b.secs - a.secs).slice(0, UNITS_SHOWN);
}

export function buildLineups(i: LineupInputs): LineupState {
  const tl = timeline(i.actions, i.lacIsHome);
  const now = elapsedSecs(i.period, i.clockSec);
  const marginNow = tl.margin.at(-1) ?? 0;

  const onCourt = (team: BoxscoreTeam) =>
    team.players.filter((p) => p.oncourt === '1').map((p) => ({ p, start: stintStart(p.personId, team, i, tl) }));
  const toStint = (side: 'lac' | 'opp') => ({ p, start }: { p: BoxscorePlayer; start: Stint }): StintPlayer => {
    const delta = marginNow - start.margin;
    const min = round1(isoMinutes(p.statistics.minutes));
    const usual = i.usualMin[String(p.personId)] ?? null;
    return {
      player_id: p.personId,
      name: shortName(p),
      stint_start: { period: start.period, clock: start.clock },
      stint_secs: Math.max(0, now - start.t),
      stint_plus_minus: side === 'lac' ? delta : -delta,
      pf: p.statistics.foulsPersonal,
      foul_trouble: inFoulTrouble(i.period, p.statistics.foulsPersonal),
      min,
      usual_min: usual,
      pace: minutesPace(min, usual, now),
    };
  };

  const lacOn = onCourt(i.lacBox);
  const newest = lacOn.reduce<Stint | null>((best, s) => (!best || s.start.t > best.t ? s.start : best), null);

  return {
    on_court: { lac: lacOn.map(toStint('lac')), opp: onCourt(i.oppBox).map(toStint('opp')) },
    current_unit: newest
      ? { lac_plus_minus: marginNow - newest.margin, secs_together: Math.max(0, now - newest.t) }
      : { lac_plus_minus: 0, secs_together: 0 },
    units_tonight: unitsTonight(i, tl, now, marginNow),
    timeouts: {
      lac: i.lacBox.timeoutsRemaining ?? i.fallback?.timeouts.lac ?? null,
      opp: i.oppBox.timeoutsRemaining ?? i.fallback?.timeouts.opp ?? null,
    },
    bonus: {
      lac: i.lacBox.inBonus !== undefined ? i.lacBox.inBonus === '1' : (i.fallback?.bonus.lac ?? false),
      opp: i.oppBox.inBonus !== undefined ? i.oppBox.inBonus === '1' : (i.fallback?.bonus.opp ?? false),
    },
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run scripts/lib/live-lineups.test.ts`
Expected: PASS (all). The starters' unit is +2: it closes at the Q2 6:00 substitution with the score 10–8.

- [ ] **Step 6: Full verification and commit**

Run the Global Constraints verification.

```bash
git add src/lib/types/live.ts scripts/lib/live-lineups.ts scripts/lib/live-lineups.test.ts
git commit -m "feat(live): rotation clipboard derivation (stints, fouls, minutes, units)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The runner derives `wp`, `flow` and `lineups`

**Files:**
- Modify: `scripts/lib/live-state.ts`, `scripts/lib/live-state.test.ts`, `scripts/lib/live-poller.ts`, `scripts/lib/live-poller.test.ts`, `scripts/lib/live-store.ts`, `scripts/game-night.ts`, `app/api/cron/poll-live/route.ts`

**Interfaces:**
- Consumes: `buildFlow` (Task 3), `buildLineups` (Task 4), `winProbability`, `expectedLacMargin`, `DEFAULT_SIGMA`, `PERIOD_SECS` (Task 1), `WP_MODEL_KEY` (Task 2), `LAC_TEAM_ID` (`poll-live-logic.ts`).
- Produces:
  - `ModelContext = { expected: number; expectedSource: 'spread' | 'home_court'; sigma: number; calibration: WpCalibration | null; usualMin: Record<string, number> }` and `defaultModel(lacIsHome)` in `scripts/lib/live-state.ts`; `StateInputs.model?: ModelContext`.
  - Every doc the runner builds carries `wp` (always), `flow` (null before tip) and `lineups` (null until both box scores exist).
  - `createPoller(nbaGameId, tipAt, deps, initialSeq = 0, model?: ModelContext)`.
  - `loadModelContext(sql, gameDbId): Promise<ModelContext | null>` in `scripts/lib/live-store.ts`.

All files here are bundled by the cron route: **suffix-less imports** (the tests keep `.js`).

- [ ] **Step 1: Write the failing tests**

Append to `scripts/lib/live-state.test.ts` (it already imports `buildLiveState`, `box`, `sbGame`, `action`, and defines `inputs()` and `NOW`):

```ts
import { defaultModel, type ModelContext } from './live-state.js';
import { DEFAULT_SIGMA, normalCdf, winProbability } from '../../src/lib/live/win-prob.js';

const MODEL: ModelContext = {
  expected: 4.5,
  expectedSource: 'spread',
  sigma: 12,
  calibration: null,
  usualMin: {},
};

describe('buildLiveState — Plan 3 fields', () => {
  it('gives the pregame win probability before tip, and no flow or lineups', () => {
    const body = buildLiveState(inputs({ sbGame: sbGame({ status: 1 }), phase: 'PREGAME', nextMs: 30_000, model: MODEL }));
    expect(body.wp).toMatchObject({ model: 'stern-v1', sigma: 12, expected_margin: 4.5, expected_source: 'spread', calibration: null });
    expect(body.wp!.lac).toBeCloseTo(normalCdf(4.5 / 12), 3);
    expect(body.flow).toBeNull();
    expect(body.lineups).toBeNull();
  });

  it('gives the live win probability from the current margin and clock', () => {
    const body = buildLiveState(inputs({
      box: box({ period: 2, clock: 'PT04M32.00S', home: 30, away: 28 }),
      actions: [action(1, { clock: 'PT04M32.00S', period: 2, scoreHome: '30', scoreAway: '28' })],
      model: MODEL,
    }));
    const expected = winProbability({ margin: 2, period: 2, clockSec: 272, expected: 4.5, sigma: 12 });
    expect(body.wp!.lac).toBeCloseTo(expected, 3);
    expect(body.flow!.points.at(-1)).toMatchObject({ m: 2, a: 1 });
    expect(body.lineups).toMatchObject({ on_court: { lac: [], opp: [] } });
  });

  it('settles the win probability at the final buzzer', () => {
    const body = buildLiveState(inputs({ box: box({ status: 3, period: 4, clock: 'PT00M00.00S', home: 101, away: 99 }), model: MODEL }));
    expect(body.wp!.lac).toBe(1);
  });

  it('uses the default model without a context: home court and the default σ', () => {
    const body = buildLiveState(inputs({ sbGame: sbGame({ status: 1 }), phase: 'PREGAME' }));
    expect(body.wp).toMatchObject({ sigma: DEFAULT_SIGMA, expected_margin: 2.5, expected_source: 'home_court' });
    expect(defaultModel(false).expected).toBe(-2.5);
  });
});
```

(Move the two new `import` lines to the top of the file with the existing imports.)

In `scripts/lib/live-poller.test.ts`, add inside `describe('createPoller', …)` (the file's `harness()` already fakes an in-progress game):

```ts
  it('builds docs with the model it was given', async () => {
    const { deps } = harness();
    const model = { expected: -3, expectedSource: 'spread' as const, sigma: 11, calibration: null, usualMin: {} };
    const r = await createPoller(GAME_ID, TIP, deps, 0, model).tick();
    expect(r.doc?.wp).toMatchObject({ sigma: 11, expected_margin: -3, expected_source: 'spread' });
    expect(r.doc?.flow?.points.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run scripts/lib/live-state.test.ts scripts/lib/live-poller.test.ts`
Expected: FAIL — `defaultModel` is not exported; `wp` undefined.

- [ ] **Step 3: Build the fields in `live-state.ts`**

Add to the imports of `scripts/lib/live-state.ts`:

```ts
import type { LiveWinProb, WpCalibration } from '../../src/lib/types/live-state';
import { DEFAULT_SIGMA, expectedLacMargin, PERIOD_SECS, winProbability } from '../../src/lib/live/win-prob';
import { buildFlow } from './live-flow';
import { buildLineups } from './live-lineups';
```

and change the two existing imports to:

```ts
import { clockToSecondsRemaining, parseNBAClock } from './nba-live-client';
import { extractRecentScoring, LAC_TEAM_ID, lineScore, summarizeOtherGames } from './poll-live-logic';
```

Add after `export type LiveStateBody …`:

```ts
/** What the runner knows before the game: the model's inputs (loaded once per game by loadModelContext). */
export interface ModelContext {
  expected: number;                          // pregame expected LAC margin
  expectedSource: 'spread' | 'home_court';
  sigma: number;
  calibration: WpCalibration | null;
  usualMin: Record<string, number>;          // NBA personId → last-10-game average minutes
}

export function defaultModel(lacIsHome: boolean): ModelContext {
  const e = expectedLacMargin(null, lacIsHome);
  return { expected: e.expected, expectedSource: e.source, sigma: DEFAULT_SIGMA, calibration: null, usualMin: {} };
}

function liveWinProb(
  status: LiveStateDoc['status'],
  period: number,
  clockSec: number,
  lacMargin: number,
  model: ModelContext
): LiveWinProb {
  const { expected, sigma } = model;
  const lac =
    status === 'scheduled'
      ? winProbability({ margin: 0, period: 1, clockSec: PERIOD_SECS, expected, sigma })
      : status === 'final'
        ? lacMargin > 0 ? 1 : lacMargin < 0 ? 0 : 0.5
        : winProbability({ margin: lacMargin, period, clockSec, expected, sigma });
  return {
    lac: Math.round(lac * 1000) / 1000,
    model: 'stern-v1',
    sigma,
    expected_margin: expected,
    expected_source: model.expectedSource,
    calibration: model.calibration,
  };
}
```

Add `model?: ModelContext;` to `StateInputs` (after `now`).

In `buildLiveState`, compute these before the `return` (after `observed`):

```ts
  const lacIsHome = i.sbGame.homeTeam.teamId === LAC_TEAM_ID;
  const model = i.model ?? defaultModel(lacIsHome);
  const status = statusOf(Math.max(i.sbGame.gameStatus, b?.gameStatus ?? 0));
  const homeScore = head?.homeTeam.score ?? i.sbGame.homeTeam.score;
  const awayScore = head?.awayTeam.score ?? i.sbGame.awayTeam.score;
  const clockSec = clockToSecondsRemaining(isoClock);
  const sbLac = lacIsHome ? i.sbGame.homeTeam : i.sbGame.awayTeam;
  const sbOpp = lacIsHome ? i.sbGame.awayTeam : i.sbGame.homeTeam;
```

and in the returned object use `status`, `home_score: homeScore`, `away_score: awayScore` (replacing the inline expressions), then add after `stale_reason: null,`:

```ts
    wp: liveWinProb(status, period, clockSec, lacIsHome ? homeScore - awayScore : awayScore - homeScore, model),
    flow: status === 'scheduled' ? null : buildFlow(i.actions, lacIsHome, model),
    lineups:
      status !== 'scheduled' && b
        ? buildLineups({
            actions: i.actions,
            lacBox: lacIsHome ? b.homeTeam : b.awayTeam,
            oppBox: lacIsHome ? b.awayTeam : b.homeTeam,
            lacIsHome,
            period,
            clockSec,
            usualMin: model.usualMin,
            fallback: {
              timeouts: { lac: sbLac.timeoutsRemaining ?? null, opp: sbOpp.timeoutsRemaining ?? null },
              bonus: { lac: sbLac.inBonus === '1', opp: sbOpp.inBonus === '1' },
            },
          })
        : null,
```

`fingerprint` needs no change: `wp`, `flow` and `lineups` only change when the plays, clock or box change, which already change the fingerprint.

- [ ] **Step 4: Thread the model through the poller**

In `scripts/lib/live-poller.ts`:
- import `type ModelContext` from `./live-state` (same import line as `buildLiveState`);
- change the signature to `export function createPoller(nbaGameId: string, tipAt: number | null, deps: PollerDeps, initialSeq = 0, model?: ModelContext): Poller`;
- pass it to the builder: `buildLiveState({ sbGame, sbGames, box, actions, phase, nextMs: delayMs, now, model })`.

- [ ] **Step 5: Load the model context**

Add to `scripts/lib/live-store.ts`:

```ts
import type { WpCalibration } from '../../src/lib/types/live-state';
import { DEFAULT_SIGMA, expectedLacMargin } from '../../src/lib/live/win-prob';
import type { ModelContext } from './live-state';
import { WP_MODEL_KEY } from './wp-calibrate';

/**
 * The win-probability and clipboard inputs for one game, read once when the
 * runner starts: the Clippers' closing spread (the newest odds snapshot taken
 * at or before tip), the fitted σ from app_kv, and each player's last-10-game
 * average minutes. Null when the game row doesn't exist.
 */
export async function loadModelContext(sql: Sql, gameDbId: string): Promise<ModelContext | null> {
  const [g] = await sql<{ lac_home: boolean; home_team_id: string; away_team_id: string; lac_spread: number | null }[]>`
    SELECT
      (g.home_team_id = lac.team_id) AS lac_home,
      g.home_team_id::text           AS home_team_id,
      g.away_team_id::text           AS away_team_id,
      (SELECT (CASE WHEN g.home_team_id = lac.team_id THEN o.spread_home ELSE o.spread_away END)::float8
         FROM odds_snapshots o
        WHERE o.game_id = g.game_id
          AND (g.start_time_utc IS NULL OR o.captured_at <= g.start_time_utc)
        ORDER BY o.captured_at DESC
        LIMIT 1)                     AS lac_spread
    FROM games g
    JOIN teams lac ON lac.abbreviation = 'LAC'
    WHERE g.game_id = ${gameDbId}::bigint
  `;
  if (!g) return null;
  const e = expectedLacMargin(g.lac_spread, g.lac_home);

  const [kv] = await sql<{ value: WpCalibration }[]>`SELECT value FROM app_kv WHERE key = ${WP_MODEL_KEY}`;
  const calibration = kv?.value ?? null;
  const sigma = calibration && Number.isFinite(calibration.sigma) && calibration.sigma > 0 ? calibration.sigma : DEFAULT_SIGMA;

  const rows = await sql<{ person_id: number; minutes: number | null }[]>`
    SELECT DISTINCT ON (r.player_id) p.nba_person_id AS person_id, r.minutes::float8 AS minutes
    FROM rolling_player_stats r
    JOIN players p ON p.player_id = r.player_id
    WHERE r.window_games = 10
      AND p.nba_person_id IS NOT NULL
      AND r.team_id IN (${g.home_team_id}::bigint, ${g.away_team_id}::bigint)
    ORDER BY r.player_id, r.as_of_game_date DESC
  `;
  const usualMin: Record<string, number> = {};
  for (const r of rows) if (r.minutes !== null && r.minutes > 0) usualMin[String(r.person_id)] = Math.round(r.minutes * 10) / 10;

  return { expected: e.expected, expectedSource: e.source, sigma, calibration, usualMin };
}
```

Note the `Sql` type import already exists at the top of the file.

- [ ] **Step 6: Use it in the runner and the cron route**

In `scripts/game-night.ts` `pollLoop`, import `loadModelContext` alongside `loadLiveSeq` (`from './lib/live-store.js'`) and replace the `createPoller` line with:

```ts
  // Best-effort: without it the runner uses home court and the default σ.
  const model = await loadModelContext(sql, candidate.game_id).catch((err: unknown) => {
    console.warn(`[game-night] Model inputs unavailable, using defaults: ${(err as Error).message}`);
    return null;
  });
  if (model) {
    console.log(
      `[game-night] Win prob: E ${model.expected} (${model.expectedSource}), σ ${model.sigma}` +
        `${model.calibration ? '' : ' (default)'}; usual minutes for ${Object.keys(model.usualMin).length} players`
    );
  }
  const poller = createPoller(candidate.nba_game_id, tip?.getTime() ?? null, deps, initialSeq, model ?? undefined);
```

In `app/api/cron/poll-live/route.ts`, import `loadModelContext` alongside `loadLiveSeq` and do the same (without the log line):

```ts
    const model = await loadModelContext(sql, candidate.game_id).catch(() => null);
    const poller = createPoller(
      candidate.nba_game_id,
      candidate.start_time_utc?.getTime() ?? null,
      deps,
      initialSeq,
      model ?? undefined
    );
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run scripts/lib/live-state.test.ts scripts/lib/live-poller.test.ts`
Expected: PASS. If an existing test compared a whole doc with `toEqual`, it now sees `wp`/`flow`/`lineups`: update that expectation to include the new fields (or switch it to `toMatchObject` on the fields it was checking), never delete the assertion.

- [ ] **Step 8: Full verification and commit**

Run the Global Constraints verification — `npm run build` matters here (the cron route bundles every file above).

```bash
git add scripts/lib/live-state.ts scripts/lib/live-state.test.ts scripts/lib/live-poller.ts scripts/lib/live-poller.test.ts scripts/lib/live-store.ts scripts/game-night.ts app/api/cron/poll-live/route.ts
git commit -m "feat(live): the runner derives win probability, game flow and lineups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Protocol `flow_append` and the new payload fields

**Files:**
- Modify: `src/lib/live/protocol.ts`, `src/lib/live/protocol.test.ts`, `src/lib/ui/types.ts`, `src/lib/live/payload.ts`, `src/lib/live/payload.test.ts`, `app/api/live/route.ts`

**Interfaces:**
- Consumes: `LiveFlow`, `FlowPoint`, `FlowMarker`, `LiveWinProb`, `LineupState` (Task 1).
- Produces:
  - `FlowAppend = { from: number; points: FlowPoint[]; markers: FlowMarker[] }`; `DeltaMessage.flow_append?: FlowAppend`. `diffDocs` sends only new points when the old series is a prefix of the new one; `applyMessage` appends, or asks for a keyframe when `from` doesn't match.
  - `LivePayload.flow?: LiveFlow | null`, `.wp?: LiveWinProb | null`, `.lineups?: LineupState | null`, `.observed_at?: string | null`, set by `/api/live` (LIVE and DATA_DELAYED) and by `overlayLiveDoc`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/live/protocol.test.ts` (it already imports `diffDocs`, `applyMessage` and `liveDoc`; put the new type import at the top):

```ts
import type { FlowMarker, FlowPoint } from '../types/live-state';

const P = (t: number, m: number): FlowPoint => ({ t, m, wp: 0.5, a: t, d: `play ${t}` });
const RUN: FlowMarker = { kind: 'run', t: 90, t_start: 30, side: 'lac', pts: 8 };

describe('flow deltas', () => {
  it('send only the new points, and rebuild the same state', () => {
    const prev = liveDoc(1, { flow: { points: [P(0, 0), P(30, 2)], markers: [] } });
    const next = liveDoc(2, { flow: { points: [P(0, 0), P(30, 2), P(90, 8)], markers: [RUN] } });
    const d = diffDocs(prev, next);
    expect(d.patch.flow).toBeUndefined();
    expect(d.flow_append).toEqual({ from: 2, points: [P(90, 8)], markers: [RUN] });
    expect(applyMessage(prev, d).state).toEqual(next);
  });

  it('send the whole series when an earlier point changed', () => {
    const prev = liveDoc(1, { flow: { points: [P(0, 0), P(30, 2)], markers: [] } });
    const next = liveDoc(2, { flow: { points: [P(0, 0), P(30, 3)], markers: [] } });
    const d = diffDocs(prev, next);
    expect(d.flow_append).toBeUndefined();
    expect(d.patch.flow).toEqual(next.flow);
    expect(applyMessage(prev, d).state).toEqual(next);
  });

  it('carry nothing when the flow did not change', () => {
    const flow = { points: [P(0, 0)], markers: [] };
    const d = diffDocs(liveDoc(1, { flow }), liveDoc(2, { flow, clock: '9:59' }));
    expect(d.flow_append).toBeUndefined();
    expect(d.patch.flow).toBeUndefined();
  });

  it('ask for a keyframe when an append does not line up', () => {
    const state = liveDoc(1, { flow: { points: [P(0, 0)], markers: [] } });
    const r = applyMessage(state, {
      kind: 'delta', seq: 2, base_seq: 1, patch: {}, flow_append: { from: 2, points: [P(90, 8)], markers: [] },
    });
    expect(r).toEqual({ state, applied: false, needKeyframe: true });
  });
});
```

Append inside `describe('overlayLiveDoc', …)` in `src/lib/live/payload.test.ts` (the file has `base()` and imports `liveDoc`):

```ts
  it('carries flow, win probability, lineups and observed_at', () => {
    const flow = { points: [{ t: 0, m: 0, wp: 0.6, a: 0, d: '' }], markers: [] };
    const wp = { lac: 0.62, model: 'stern-v1' as const, sigma: 12, expected_margin: 3, expected_source: 'spread' as const, calibration: null };
    const lineups = {
      on_court: { lac: [], opp: [] }, current_unit: { lac_plus_minus: 0, secs_together: 0 },
      units_tonight: [], timeouts: { lac: 7, opp: 7 }, bonus: { lac: false, opp: false },
    };
    const out = overlayLiveDoc(base(), liveDoc(9, { flow, wp, lineups, observed_at: '2026-10-22T02:41:00.000Z' }));
    expect(out.flow).toEqual(flow);
    expect(out.wp).toEqual(wp);
    expect(out.lineups).toEqual(lineups);
    expect(out.observed_at).toBe('2026-10-22T02:41:00.000Z');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/live/protocol.test.ts src/lib/live/payload.test.ts`
Expected: FAIL — `flow_append` undefined, `patch.flow` set; `out.flow` undefined.

- [ ] **Step 3: Extend the protocol**

In `src/lib/live/protocol.ts`:

Change the type import to `import type { FlowMarker, FlowPoint, LiveFlow, LiveStateDoc } from '../types/live-state';` and add after `TeamPatch`:

```ts
/** New flow points on top of a series of `from` points; markers are sent whole (there are few). */
export interface FlowAppend {
  from: number;
  points: FlowPoint[];
  markers: FlowMarker[];
}
```

Add to `DeltaMessage` (after `box`):

```ts
  /** The flow series grew: append these instead of patching `flow` whole. */
  flow_append?: FlowAppend;
```

Add above `diffDocs`:

```ts
function flowAppend(prev: LiveFlow | null | undefined, next: LiveFlow | null | undefined): FlowAppend | undefined {
  if (!prev || !next || next.points.length < prev.points.length) return undefined;
  if (!same(prev.points, next.points.slice(0, prev.points.length))) return undefined;
  return { from: prev.points.length, points: next.points.slice(prev.points.length), markers: next.markers };
}
```

Replace the body of `diffDocs` with:

```ts
export function diffDocs(prev: LiveStateDoc, next: LiveStateDoc): DeltaMessage {
  const patch: Record<string, unknown> = {};
  let append: FlowAppend | undefined;
  for (const key of Object.keys(next) as (keyof LiveStateDoc)[]) {
    if (key === 'seq' || key === 'home_box' || key === 'away_box') continue;
    if (same(prev[key], next[key])) continue;
    if (key === 'flow') {
      append = flowAppend(prev.flow, next.flow);
      if (append) continue;
    }
    patch[key] = next[key];
  }
  const box: NonNullable<DeltaMessage['box']> = {};
  const home = diffTeam(prev.home_box, next.home_box);
  if (home !== undefined) box.home = home;
  const away = diffTeam(prev.away_box, next.away_box);
  if (away !== undefined) box.away = away;
  return {
    kind: 'delta',
    seq: next.seq,
    base_seq: prev.seq,
    patch: patch as DeltaMessage['patch'],
    ...(Object.keys(box).length > 0 ? { box } : {}),
    ...(append ? { flow_append: append } : {}),
  };
}
```

In `applyMessage`, after `const next = { ...state, ...msg.patch, seq: msg.seq } as LiveStateDoc;` insert:

```ts
  if (msg.flow_append) {
    const flow = state.flow;
    if (!flow || flow.points.length !== msg.flow_append.from) return { state, applied: false, needKeyframe: true };
    next.flow = { points: [...flow.points, ...msg.flow_append.points], markers: msg.flow_append.markers };
  }
```

- [ ] **Step 4: Add the payload fields**

In `src/lib/ui/types.ts`, extend the existing `import type { LivePhase } from '../types/live-state'` to also import `LineupState, LiveFlow, LiveWinProb`, and add to `LivePayload` (after `upcoming`):

```ts
  /** Game flow series + markers (Live v2 Plan 3); null before tip. */
  flow?: LiveFlow | null
  /** Model win probability; a model estimate, labeled as one. */
  wp?: LiveWinProb | null
  /** Rotation clipboard; null until both box scores exist. */
  lineups?: LineupState | null
  /** NBA wall-clock time of the newest play in this state (spoiler sync). */
  observed_at?: string | null
```

In `src/lib/live/payload.ts` `overlayLiveDoc`, add to the returned object after `cadence: doc.cadence,`:

```ts
    flow: doc.flow ?? null,
    wp: doc.wp ?? null,
    lineups: doc.lineups ?? null,
    observed_at: doc.observed_at,
```

In `app/api/live/route.ts`, add the same four fields, read from the snapshot, to **both** the DATA_DELAYED response object (after `cadence: payload.cadence ?? null,`) and the LIVE one:

```ts
          flow: payload.flow ?? null,
          wp: payload.wp ?? null,
          lineups: payload.lineups ?? null,
          observed_at: payload.observed_at ?? null,
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/live/protocol.test.ts src/lib/live/payload.test.ts`
Expected: PASS.

- [ ] **Step 6: Full verification and commit**

Run the Global Constraints verification. Also run the hub's tests — the hub relays `flow_append` untouched, and its tests must still pass: `cd workers/live-hub && npm test`.

```bash
git add src/lib/live/protocol.ts src/lib/live/protocol.test.ts src/lib/ui/types.ts src/lib/live/payload.ts src/lib/live/payload.test.ts app/api/live/route.ts
git commit -m "feat(live): flow deltas append; /api/live and push carry flow, wp, lineups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: A game the runner never started still shows up

Spec §9: "Runner not started (cron delayed/dropped) … state age > 30 s while game should be live → clients switch to the ESPN backup tier." Today, with no `live_state` row at all, `/api/live` says `NO_ACTIVE_GAME`, so the backup never engages. Plan 2 deferred this.

**Files:**
- Modify: `src/lib/live/payload.ts`, `src/lib/live/payload.test.ts`, `app/api/live/route.ts`, `components/live/LiveView.tsx`

**Interfaces:**
- Consumes: `needsBackup` (`src/lib/live/stream.ts`), `overlayEspn` (`src/lib/live/espn-backup.ts`), `buildMeta` (`src/lib/api-utils.ts`).
- Produces: `RUNNER_NOT_STARTED_REASON = 'live feed not started'` and `notStartedPayload(game: LiveGame, meta: MetaEnvelope, otherGames?: unknown[]): LivePayload` in `src/lib/live/payload.ts`.

Rule: when **no** recent `live_state` row exists and a non-final Clippers game's scheduled tip was between 4 hours and 10 minutes ago, `/api/live` returns `DATA_DELAYED` with that game (status `in_progress`, no score, no stats) and `stale_reason = RUNNER_NOT_STARTED_REASON`. The browser's existing backup tier then fills in ESPN's score. The 10-minute grace covers tips that run late while the runner is still starting.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/live/payload.test.ts`, merging these imports into the existing ones at the top (the file already imports `overlayLiveDoc` from `./payload` and `LivePayload` from `../ui/types`):

```ts
import { notStartedPayload, RUNNER_NOT_STARTED_REASON } from './payload';
import { needsBackup } from './stream';
import { overlayEspn } from './espn-backup';
import type { LiveGame } from '../ui/types';

describe('notStartedPayload', () => {
  const game: LiveGame = {
    game_id: '77', nba_game_id: '0022600093', season_id: 2026, game_date: '2026-10-21', start_time_utc: '2026-10-22T02:30:00Z',
    status: 'scheduled', period: null, clock: null,
    home: { team_id: '13', abbreviation: 'LAC', name: 'Clippers', score: null, is_home: true },
    away: { team_id: '24', abbreviation: 'SAC', name: 'Kings', score: null, is_home: false },
  };
  const meta = { generated_at: '2026-10-22T02:45:00.000Z', source: 'mixed' as const, stale: true, stale_reason: RUNNER_NOT_STARTED_REASON, ttl_seconds: 5 };

  it('is a delayed, in-progress game with nothing but its identity', () => {
    const p = notStartedPayload(game, meta);
    expect(p.state).toBe('DATA_DELAYED');
    expect(p.meta.stale_reason).toBe(RUNNER_NOT_STARTED_REASON);
    expect(p.game).toMatchObject({ game_id: '77', status: 'in_progress', period: null, clock: null });
    expect(p.game!.home.score).toBeNull();
    expect(p).toMatchObject({ key_metrics: [], box_score: null, insights: [], odds: null, flow: null, wp: null, lineups: null });
  });

  it('switches the browser to the ESPN backup, which fills in the score', () => {
    const p = notStartedPayload(game, meta);
    expect(needsBackup(p, false)).toBe(true);
    const shown = overlayEspn(p, { status: 'in_progress', status_text: 'Q1 8:12', period: 1, clock: '8:12', home: 9, away: 7 });
    expect(shown.game).toMatchObject({ period: 1, clock: '8:12', home: { score: 9 }, away: { score: 7 } });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/live/payload.test.ts`
Expected: FAIL — `notStartedPayload` is not exported.

- [ ] **Step 3: Write the payload builder**

Add to `src/lib/live/payload.ts` (extend its `../ui/types` type import with `LiveGame`, and add `import type { MetaEnvelope } from '../api-utils';`):

```ts
/** meta.stale_reason when a game should be on but the runner has written nothing (spec §9). */
export const RUNNER_NOT_STARTED_REASON = 'live feed not started';

/**
 * A game that should have tipped but has no live state at all: the runner
 * never started (its cron was delayed or dropped). DATA_DELAYED with only the
 * game's identity, so /live shows the game and the browser's ESPN backup tier
 * fills in the score (spec §9).
 */
export function notStartedPayload(game: LiveGame, meta: MetaEnvelope, otherGames: unknown[] = []): LivePayload {
  return {
    meta,
    state: 'DATA_DELAYED',
    game: {
      ...game,
      status: 'in_progress',
      status_text: null,
      period: null,
      clock: null,
      periods: [],
      home: { ...game.home, score: null },
      away: { ...game.away, score: null },
    },
    key_metrics: [],
    box_score: null,
    insights: [],
    other_games: otherGames,
    odds: null,
    cadence: null,
    flow: null,
    wp: null,
    lineups: null,
    observed_at: null,
  };
}
```

- [ ] **Step 4: Serve it from `/api/live`**

In `app/api/live/route.ts`, import `notStartedPayload, RUNNER_NOT_STARTED_REASON` from `@/src/lib/live/payload` and `type { LiveGame }` from `@/src/lib/ui/types`. In Step 2 of `GET`, as the first statement inside `if (!snap || !payload || payload.status === 'scheduled') {`, add:

```ts
      // No live state at all, but a game should be on: the runner never
      // started. Serve the game so the browser's ESPN backup can take over.
      if (!snap) {
        const missed = await fetchMissedGame();
        if (missed) {
          return NextResponse.json(
            notStartedPayload(missed, buildMeta('mixed', 5, true, RUNNER_NOT_STARTED_REASON)),
            CDN_LIVE
          );
        }
      }
```

and add this helper in the Helpers section:

```ts
/**
 * A non-final Clippers game whose tip was 10 minutes to 4 hours ago. Only
 * consulted when no live_state row exists: the runner never started.
 */
async function fetchMissedGame(): Promise<LiveGame | null> {
  const [row] = await sql<GameRow[]>`
    SELECT
      g.game_id::text          AS game_id,
      g.nba_game_id::text      AS nba_game_id,
      g.season_id,
      g.game_date::text        AS game_date,
      to_char(g.start_time_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time_utc,
      g.home_team_id::text     AS home_team_id,
      ht.abbreviation          AS home_abbr,
      ht.name                  AS home_name,
      g.away_team_id::text     AS away_team_id,
      at.abbreviation          AS away_abbr,
      at.name                  AS away_name
    FROM games g
    JOIN teams ht ON ht.team_id = g.home_team_id
    JOIN teams at ON at.team_id = g.away_team_id
    JOIN teams lac ON lac.nba_team_id = ${LAC_NBA_TEAM_ID}
    WHERE (g.home_team_id = lac.team_id OR g.away_team_id = lac.team_id)
      AND lower(g.status) <> 'final'
      AND g.start_time_utc BETWEEN now() - interval '4 hours' AND now() - interval '10 minutes'
    ORDER BY g.start_time_utc DESC
    LIMIT 1
  `;
  if (!row) return null;
  return {
    game_id: row.game_id,
    nba_game_id: row.nba_game_id,
    season_id: row.season_id,
    game_date: row.game_date,
    start_time_utc: row.start_time_utc,
    status: 'in_progress',
    period: null,
    clock: null,
    home: { team_id: row.home_team_id, abbreviation: row.home_abbr, name: row.home_name, score: null, is_home: true },
    away: { team_id: row.away_team_id, abbreviation: row.away_abbr, name: row.away_name, score: null, is_home: false },
  };
}
```

- [ ] **Step 5: Say so on the page**

In `components/live/LiveView.tsx`, import `RUNNER_NOT_STARTED_REASON` from `@/src/lib/live/payload`, add `const notStarted = data.meta.stale_reason === RUNNER_NOT_STARTED_REASON` next to `onBackup`, and make the delayed banner's text:

```tsx
            {onBackup
              ? "Our live feed is delayed. Score and clock are from ESPN's backup feed."
              : notStarted
                ? "Our live feed hasn't started. Checking ESPN's scoreboard for the score…"
                : `Feed delayed${delayAge ? ` · last update ${delayAge} ago` : ''}. Showing the most recent snapshot.`}
```

- [ ] **Step 6: Run the tests and a dev check**

Run: `npx vitest run src/lib/live/payload.test.ts` → PASS.

Dev check of the page states: `npm run dev`, open `http://localhost:3000/dev/live` → the fixture still renders; then stop the server. (`/api/live` in dev returns `NO_ACTIVE_GAME` today; the new branch only fires with a missed game in the database, which the preseason check in Task 12 covers.)

- [ ] **Step 7: Full verification and commit**

Run the Global Constraints verification.

```bash
git add src/lib/live/payload.ts src/lib/live/payload.test.ts app/api/live/route.ts components/live/LiveView.tsx
git commit -m "feat(live): a game the runner never started falls back to ESPN instead of 'no game'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Game-flow chart and the model's win probability on the scoreboard

**Files:**
- Create: `src/lib/live/flow-view.ts`, `src/lib/live/flow-view.test.ts`, `components/live/GameFlow.tsx`, `hooks/useMediaQuery.ts`
- Modify: `components/game/WinProbabilityBar.tsx`, `components/live/LiveView.tsx`, `app/dev/live/fixture.ts`

**Interfaces:**
- Consumes: `LivePayload.flow`, `.wp` (Task 6); `formatGameTime`, `periodClockAt`, `winProbability`, `REGULATION_SECS`, `PERIOD_SECS`, `OT_SECS` (Task 1); `axisTick` (`components/charts/chart-theme.tsx`).
- Produces: `GameFlow({ flow, wp, oppAbbr, compact? })`; `useMediaQuery(query): boolean`; `WinProbabilityBar` gains `source?: 'moneyline' | 'model'`; pure helpers `flowRows`, `flowDomainEnd`, `periodTicks`, `tickLabel`, `marginDomain`, `marginText`, `flowSummary`, `markersOf` in `src/lib/live/flow-view.ts`.

Layout (spec §7.1): desktop (≥ 640 px) shows the full chart in a panel under the scoreboard; mobile shows a compact sparkline that opens the full chart on tap. The margin is an area above zero in Clippers blue (`--pacific`) and below zero in the opponent color (`--neg`), stepped (the score is a step function). WP is a dashed line on a right-hand 0–100 % axis. Runs are shaded bands labeled "8-0", the largest leads are dots, timeouts are small dots on the baseline, and period starts are dashed lines. Hover or tap shows the game time, margin, WP and the play.

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `src/lib/live/flow-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { flowDomainEnd, flowRows, flowSummary, marginDomain, marginText, markersOf, periodTicks, tickLabel } from './flow-view';
import type { LiveFlow } from '../types/live-state';

const flow = (ts: [number, number][], markers: LiveFlow['markers'] = []): LiveFlow => ({
  points: ts.map(([t, m]) => ({ t, m, wp: 0.625, a: t, d: `play ${t}` })),
  markers,
});

describe('flow-view', () => {
  it('splits the margin into a lead area and a trail area, WP in percent', () => {
    expect(flowRows(flow([[10, 3], [20, -2]]))).toEqual([
      { t: 10, lead: 3, trail: 0, m: 3, wp: 62.5, d: 'play 10' },
      { t: 20, lead: 0, trail: -2, m: -2, wp: 62.5, d: 'play 20' },
    ]);
  });

  it('ends the axis at regulation, or at the end of the last overtime reached', () => {
    expect(flowDomainEnd(flow([[0, 0], [2000, 4]]))).toBe(2880);
    expect(flowDomainEnd(flow([[2990, 1]]))).toBe(3180);
    expect(flowDomainEnd(flow([[3180, 1]]))).toBe(3180);
    expect(flowDomainEnd(flow([[3181, 1]]))).toBe(3480);
  });

  it('ticks and labels each period start', () => {
    expect(periodTicks(2880)).toEqual([0, 720, 1440, 2160]);
    expect(periodTicks(3480)).toEqual([0, 720, 1440, 2160, 2880, 3180]);
    expect([0, 2160, 2880, 3180].map(tickLabel)).toEqual(['Q1', 'Q4', 'OT', '2OT']);
  });

  it('keeps the margin axis symmetric, in steps of 5, at least ±5', () => {
    expect(marginDomain(flow([[0, 0], [10, 3]]))).toEqual([-5, 5]);
    expect(marginDomain(flow([[0, 0], [10, -12]]))).toEqual([-15, 15]);
  });

  it('names the margin', () => {
    expect(marginText(4, 'SAC')).toBe('LAC +4');
    expect(marginText(-3, 'SAC')).toBe('SAC +3');
    expect(marginText(0, 'SAC')).toBe('Tied');
  });

  it('summarizes lead changes and the largest leads, and filters markers by kind', () => {
    const f = flow([[0, 0]], [
      { kind: 'lead_change', t: 100, side: 'opp' },
      { kind: 'max_lead', t: 200, side: 'lac', margin: 9 },
      { kind: 'lead_change', t: 300, side: 'lac' },
      { kind: 'max_lead', t: 150, side: 'opp', margin: 4 },
    ]);
    expect(flowSummary(f)).toEqual({ leadChanges: 2, lac: { margin: 9, t: 200 }, opp: { margin: 4, t: 150 } });
    expect(markersOf(f, 'lead_change').map((m) => m.t)).toEqual([100, 300]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/live/flow-view.test.ts`
Expected: FAIL — cannot resolve `./flow-view`.

- [ ] **Step 3: Write the helpers**

Create `src/lib/live/flow-view.ts`:

```ts
// src/lib/live/flow-view.ts
// Pure helpers behind components/live/GameFlow.tsx: chart rows, axes, labels.

import type { FlowMarker, LiveFlow } from '../types/live-state';
import { OT_SECS, PERIOD_SECS, REGULATION_SECS } from './win-prob';

export interface FlowRow {
  t: number;
  lead: number;                // margin when LAC leads, else 0 (area above zero)
  trail: number;               // margin when LAC trails, else 0 (area below zero)
  m: number;
  wp: number;                  // percent, 1 decimal
  d: string;
}

export function flowRows(flow: LiveFlow): FlowRow[] {
  return flow.points.map((p) => ({
    t: p.t,
    lead: Math.max(0, p.m),
    trail: Math.min(0, p.m),
    m: p.m,
    wp: Math.round(p.wp * 1000) / 10,
    d: p.d,
  }));
}

/** The x-axis end: regulation, or the end of the last overtime period reached. */
export function flowDomainEnd(flow: LiveFlow): number {
  const last = flow.points.at(-1)?.t ?? 0;
  if (last <= REGULATION_SECS) return REGULATION_SECS;
  return REGULATION_SECS + Math.ceil((last - REGULATION_SECS) / OT_SECS) * OT_SECS;
}

/** Each period's start inside [0, end). */
export function periodTicks(end: number): number[] {
  const ticks: number[] = [];
  for (let t = 0; t < Math.min(end, REGULATION_SECS); t += PERIOD_SECS) ticks.push(t);
  for (let t = REGULATION_SECS; t < end; t += OT_SECS) ticks.push(t);
  return ticks;
}

export function tickLabel(t: number): string {
  if (t < REGULATION_SECS) return `Q${Math.floor(t / PERIOD_SECS) + 1}`;
  const ot = Math.floor((t - REGULATION_SECS) / OT_SECS) + 1;
  return ot === 1 ? 'OT' : `${ot}OT`;
}

/** A symmetric margin axis in steps of 5, at least ±5. */
export function marginDomain(flow: LiveFlow): [number, number] {
  const max = flow.points.reduce((a, p) => Math.max(a, Math.abs(p.m)), 0);
  const lim = Math.max(5, Math.ceil(max / 5) * 5);
  return [-lim, lim];
}

export function marginText(m: number, oppAbbr: string): string {
  return m > 0 ? `LAC +${m}` : m < 0 ? `${oppAbbr} +${-m}` : 'Tied';
}

export interface FlowSummary {
  leadChanges: number;
  lac: { margin: number; t: number } | null;
  opp: { margin: number; t: number } | null;
}

export function flowSummary(flow: LiveFlow): FlowSummary {
  const out: FlowSummary = { leadChanges: 0, lac: null, opp: null };
  for (const m of flow.markers) {
    if (m.kind === 'lead_change') out.leadChanges += 1;
    else if (m.kind === 'max_lead') out[m.side] = { margin: m.margin, t: m.t };
  }
  return out;
}

export function markersOf<K extends FlowMarker['kind']>(flow: LiveFlow, kind: K): Extract<FlowMarker, { kind: K }>[] {
  return flow.markers.filter((m): m is Extract<FlowMarker, { kind: K }> => m.kind === kind);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/live/flow-view.test.ts`
Expected: PASS.

- [ ] **Step 5: `useMediaQuery`**

Create `hooks/useMediaQuery.ts`:

```ts
'use client'

import { useSyncExternalStore } from 'react'

/** Whether a CSS media query matches; false during server rendering. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
```

(Rendering only one chart per breakpoint also keeps Recharts' `ResponsiveContainer` from measuring a `display: none` box.)

- [ ] **Step 6: The chart**

Create `components/live/GameFlow.tsx`:

```tsx
'use client'

import * as React from 'react'
import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { axisTick } from '@/components/charts/chart-theme'
import { formatGameTime } from '@/src/lib/live/win-prob'
import {
  flowDomainEnd,
  flowRows,
  flowSummary,
  marginDomain,
  marginText,
  markersOf,
  periodTicks,
  tickLabel,
  type FlowRow,
} from '@/src/lib/live/flow-view'
import type { LiveFlow, LiveWinProb } from '@/src/lib/types/live-state'

const LAC = 'var(--pacific)'
const OPP = 'var(--neg)'

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

function FlowTooltip({ row, oppAbbr }: { row: FlowRow | undefined; oppAbbr: string }) {
  if (!row) return null
  return (
    <div className="max-w-[260px] rounded-[12px] border border-line-2 bg-ink-2/95 px-3 py-2 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)] backdrop-blur">
      <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-dim">{formatGameTime(row.t)}</div>
      <div className="text-[12.5px] font-semibold tabular-nums text-text">
        {marginText(row.m, oppAbbr)} · LAC {row.wp}%
      </div>
      {row.d && <div className="mt-1 text-[12px] text-mute">{row.d}</div>}
    </div>
  )
}

/** "About this model": what the WP line is, how well it's calibrated. A model estimate, labeled as one. */
function ModelNote({ wp }: { wp: LiveWinProb }) {
  const [open, setOpen] = React.useState(false)
  const c = wp.calibration
  return (
    <div className="mt-2 font-mono text-[11px] text-dim">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="underline decoration-dotted underline-offset-2 transition-colors hover:text-mute"
      >
        About this model
      </button>
      {open && (
        <div className="mt-2 grid gap-2 font-sans text-[12.5px] leading-relaxed text-mute">
          <p className="m-0">
            A model estimate, not a betting line. It treats the rest of the game as the current margin plus the pregame
            expectation for the time left, with spread σ = {wp.sigma}. Pregame expectation: LAC {signed(wp.expected_margin)} (
            {wp.expected_source === 'spread' ? 'closing spread' : 'home-court default'}).
          </p>
          {c ? (
            <>
              <p className="m-0">
                Fitted on {c.n_games.toLocaleString()} Clippers games ({c.n_samples.toLocaleString()} minute-by-minute moments) ·
                Brier score {c.brier.toFixed(3)} · updated {new Date(c.fitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
              <table className="w-full max-w-[320px] font-mono text-[11px] tabular-nums">
                <thead className="text-dim">
                  <tr>
                    <th className="text-left font-normal">Predicted</th>
                    <th className="text-right font-normal">Actual</th>
                    <th className="text-right font-normal">Moments</th>
                  </tr>
                </thead>
                <tbody>
                  {c.reliability.map((b) => (
                    <tr key={b.lo}>
                      <td>{Math.round(b.mean_p * 100)}%</td>
                      <td className="text-right">{Math.round(b.observed * 100)}%</td>
                      <td className="text-right text-dim">{b.n.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="m-0">Not calibrated yet — using the default σ.</p>
          )}
        </div>
      )}
    </div>
  )
}

/** The game's margin over time with the model's win probability (spec §7.1). */
export function GameFlow({
  flow,
  wp,
  oppAbbr,
  compact = false,
}: {
  flow: LiveFlow
  wp: LiveWinProb | null
  oppAbbr: string
  compact?: boolean
}) {
  const rows = React.useMemo(() => flowRows(flow), [flow])
  const end = flowDomainEnd(flow)
  const [lo, hi] = marginDomain(flow)

  const areas = [
    <Area key="lead" yAxisId="m" type="stepAfter" dataKey="lead" stroke={LAC} strokeWidth={1.5} fill={LAC} fillOpacity={0.22} dot={false} activeDot={false} isAnimationActive={false} />,
    <Area key="trail" yAxisId="m" type="stepAfter" dataKey="trail" stroke={OPP} strokeWidth={1.5} fill={OPP} fillOpacity={0.18} dot={false} activeDot={false} isAnimationActive={false} />,
  ]

  if (compact) {
    return (
      <div className="h-11 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
            <XAxis dataKey="t" type="number" domain={[0, end]} hide />
            <YAxis yAxisId="m" domain={[lo, hi]} hide />
            <ReferenceLine yAxisId="m" y={0} stroke="var(--line-2)" />
            {areas}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    )
  }

  const ticks = periodTicks(end)
  const summary = flowSummary(flow)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-mute tabular-nums">
        <span>Lead changes {summary.leadChanges}</span>
        {summary.lac && <span>Largest lead LAC +{summary.lac.margin}</span>}
        {summary.opp && (
          <span>
            {oppAbbr} +{summary.opp.margin}
          </span>
        )}
        {wp && <span className="ml-auto text-text">LAC win probability {Math.round(wp.lac * 100)}%</span>}
      </div>
      <div className="h-[230px] w-full sm:h-[260px]" role="img" aria-label={`Game flow. ${marginText(flow.points.at(-1)?.m ?? 0, oppAbbr)}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 10, right: 0, bottom: 0, left: -8 }}>
            <XAxis dataKey="t" type="number" domain={[0, end]} ticks={ticks} tickFormatter={tickLabel} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis yAxisId="m" domain={[lo, hi]} tick={axisTick} axisLine={false} tickLine={false} width={34} tickFormatter={signed} />
            <YAxis yAxisId="wp" orientation="right" domain={[0, 100]} ticks={[0, 50, 100]} tick={axisTick} axisLine={false} tickLine={false} width={34} tickFormatter={(v: number) => `${v}%`} />
            <ReferenceLine yAxisId="m" y={0} stroke="var(--line-2)" />
            {ticks.slice(1).map((t) => (
              <ReferenceLine key={`p-${t}`} yAxisId="m" x={t} stroke="var(--line)" strokeDasharray="3 3" />
            ))}
            {markersOf(flow, 'run').map((r) => (
              <ReferenceArea
                key={`run-${r.t_start}`}
                yAxisId="m"
                x1={r.t_start}
                x2={r.t}
                fill={r.side === 'lac' ? LAC : OPP}
                fillOpacity={0.08}
                label={{ value: `${r.pts}-0`, position: 'insideTop', fill: 'var(--dim)', fontSize: 10 }}
              />
            ))}
            {areas}
            <Line yAxisId="wp" type="monotone" dataKey="wp" stroke="var(--text)" strokeOpacity={0.55} strokeWidth={1.25} strokeDasharray="4 3" dot={false} activeDot={false} isAnimationActive={false} />
            {markersOf(flow, 'max_lead').map((m) => (
              <ReferenceDot key={`max-${m.side}`} yAxisId="m" x={m.t} y={m.side === 'lac' ? m.margin : -m.margin} r={3.5} fill={m.side === 'lac' ? LAC : OPP} stroke="var(--ink-1)" />
            ))}
            {markersOf(flow, 'timeout').map((m) => (
              <ReferenceDot key={`to-${m.t}-${m.side}`} yAxisId="m" x={m.t} y={lo} r={2} fill={m.side === 'lac' ? LAC : 'var(--dim)'} stroke="none" />
            ))}
            <Tooltip
              cursor={{ stroke: 'var(--line-2)' }}
              content={({ active, payload }) => (
                <FlowTooltip row={active ? (payload?.[0]?.payload as FlowRow | undefined) : undefined} oppAbbr={oppAbbr} />
              )}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {wp && <ModelNote wp={wp} />}
    </div>
  )
}
```

If Recharts' types reject a prop exactly as written (for example the `label` object on `ReferenceArea`, or the `content` render function), adjust to the nearest typed form Recharts 3 accepts and note it in the report — don't add `any` or `@ts-ignore`.

- [ ] **Step 7: Label the scoreboard's win-probability bar**

In `components/game/WinProbabilityBar.tsx`, add a `source` prop (default `'moneyline'`) and use it for the label:

```tsx
/** LAC win probability: implied by the live moneyline (vig removed), or the live model's estimate. */
export function WinProbabilityBar({
  lacProb,
  oppAbbr,
  source = 'moneyline',
}: {
  lacProb: number
  oppAbbr: string
  source?: 'moneyline' | 'model'
}) {
```

and replace the label span's text `· implied by live moneyline` with `· {source === 'model' ? 'model estimate' : 'implied by live moneyline'}`.

- [ ] **Step 8: Put the chart on `/live`**

In `components/live/LiveView.tsx`:

- import `GameFlow` from `./GameFlow` and `useMediaQuery` from `@/hooks/useMediaQuery`;
- at the top of the component, next to the existing `useRef`/`useNow` (before any early return), add:

```tsx
  const wide = useMediaQuery('(min-width: 640px)')
  const [flowOpen, setFlowOpen] = React.useState(false)
```

- replace `{probs && <WinProbabilityBar lacProb={probs.a} oppAbbr={oppAbbr} />}` with:

```tsx
          {data.wp && game.status !== 'scheduled' ? (
            <WinProbabilityBar lacProb={data.wp.lac} oppAbbr={oppAbbr} source="model" />
          ) : (
            probs && <WinProbabilityBar lacProb={probs.a} oppAbbr={oppAbbr} />
          )}
```

- after the scoreboard `</section>` and before the key-metrics section, add the flow section, and bump the `--i` stagger of the two sections after it by one (key metrics 1 → 2, the box/insights grid 2 → 3):

```tsx
      {data.flow && data.flow.points.length > 1 && (
        <section className="enter" style={{ ['--i' as string]: 1 }} aria-label="Game flow">
          <Eyebrow aside={pausedNote}>Game flow</Eyebrow>
          {wide ? (
            <Panel className="p-4 sm:p-5">
              <GameFlow flow={data.flow} wp={data.wp ?? null} oppAbbr={oppAbbr} />
            </Panel>
          ) : (
            <>
              <Panel as="button" type="button" onClick={() => setFlowOpen((o) => !o)} aria-expanded={flowOpen} className="block w-full px-3 py-2 text-left">
                <GameFlow flow={data.flow} wp={data.wp ?? null} oppAbbr={oppAbbr} compact />
                <span className="font-mono text-[11px] text-dim">{flowOpen ? 'Hide the chart' : 'Tap for the full chart'}</span>
              </Panel>
              {flowOpen && (
                <Panel className="mt-2 p-3">
                  <GameFlow flow={data.flow} wp={data.wp ?? null} oppAbbr={oppAbbr} />
                </Panel>
              )}
            </>
          )}
        </section>
      )}
```

- [ ] **Step 9: Sample data for `/dev/live`**

In `app/dev/live/fixture.ts`, give the fixture a flow and a win probability consistent with its own scoreboard. Add at the top:

```ts
import { elapsedSecs, periodClockAt, winProbability } from '@/src/lib/live/win-prob'
import type { FlowMarker, FlowPoint, LiveFlow, LiveWinProb } from '@/src/lib/types/live-state'
```

add these helpers above `liveFixture`:

```ts
/** "PT07M42.00S" or "7:42" → seconds left in the period. */
function clockSecs(clock: string | null): number {
  const iso = /PT(\d+)M([\d.]+)S/.exec(clock ?? '')
  if (iso) return Number(iso[1]) * 60 + Math.floor(Number(iso[2]))
  const mmss = /^(\d+):(\d+)/.exec(clock ?? '')
  return mmss ? Number(mmss[1]) * 60 + Number(mmss[2]) : 0
}

/** A plausible, deterministic margin path that ends at the fixture's score. */
function sampleFlow(margin: number, tNow: number): { flow: LiveFlow; wp: LiveWinProb } {
  const expected = 3.5
  const sigma = 12.4
  const at = (m: number, t: number) => {
    const { period, clockSec } = periodClockAt(t)
    return Math.round(winProbability({ margin: m, period, clockSec, expected, sigma }) * 1000) / 1000
  }
  const points: FlowPoint[] = [{ t: 0, m: 0, wp: at(0, 0), a: 0, d: '' }]
  const markers: FlowMarker[] = []
  const steps = 40
  let prev = 0
  let lastSign = 0
  let best = { lac: { margin: 0, t: 0 }, opp: { margin: 0, t: 0 } }
  for (let k = 1; k <= steps; k++) {
    const t = Math.round((tNow * k) / steps)
    const m = k === steps ? margin : Math.round((margin * k) / steps + 7 * Math.sin(k / 3))
    if (m === prev) continue
    const sign = Math.sign(m)
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) markers.push({ kind: 'lead_change', t, side: sign > 0 ? 'lac' : 'opp' })
    if (sign !== 0) lastSign = sign
    if (m > best.lac.margin) best = { ...best, lac: { margin: m, t } }
    if (-m > best.opp.margin) best = { ...best, opp: { margin: -m, t } }
    points.push({ t, m, wp: at(m, t), a: k * 3, d: m > prev ? 'Clippers score' : 'Opponent scores' })
    prev = m
  }
  for (const t of [720, 1440, 2160]) if (t < tNow) markers.push({ kind: 'period_end', t, period: t / 720 })
  markers.push({ kind: 'timeout', t: Math.round(tNow * 0.45), side: 'opp' })
  if (best.lac.margin > 0) markers.push({ kind: 'max_lead', t: best.lac.t, side: 'lac', margin: best.lac.margin })
  if (best.opp.margin > 0) markers.push({ kind: 'max_lead', t: best.opp.t, side: 'opp', margin: best.opp.margin })
  markers.sort((a, b) => a.t - b.t)
  const wp: LiveWinProb = {
    lac: at(margin, tNow),
    model: 'stern-v1',
    sigma,
    expected_margin: expected,
    expected_source: 'spread',
    calibration: {
      sigma, brier: 0.162, n_games: 1312, n_samples: 62976, fitted_at: new Date().toISOString(),
      reliability: [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95].map((p, i) => ({
        lo: i / 10, hi: (i + 1) / 10, n: 4000 + i * 150, mean_p: p, observed: Math.round((p + (i % 2 ? 0.01 : -0.01)) * 1000) / 1000,
      })),
    },
  }
  return { flow: { points, markers }, wp }
}
```

Then change `liveFixture` from `return { … }` to building `const payload: LivePayload = { … }` and end it with:

```ts
  const g = payload.game!
  const lacHome = g.home.abbreviation === 'LAC'
  const margin = ((lacHome ? g.home.score : g.away.score) ?? 0) - ((lacHome ? g.away.score : g.home.score) ?? 0)
  return { ...payload, ...sampleFlow(margin, elapsedSecs(g.period ?? 1, clockSecs(g.clock))) }
```

- [ ] **Step 10: Check it renders**

Run the Global Constraints verification, then `npm run dev` and open `http://localhost:3000/dev/live`:
- Desktop width: a "Game flow" panel under the scoreboard with the blue/red stepped area, the dashed WP line, period lines, the largest-lead dots, and a tooltip on hover showing e.g. "Q2 4:31 · LAC +6 · LAC 71.2% · Clippers score". "About this model" opens the explanation and the reliability table. The scoreboard bar reads "model estimate".
- Resize below 640 px: a sparkline panel; tapping it opens the full chart.
- No console errors (a Recharts "width(0)" warning means a chart rendered in a hidden box — fix it).

Stop the dev server. If `next dev` rewrote `AGENTS.md`, restore it with `git checkout -- AGENTS.md`.

- [ ] **Step 11: Commit**

```bash
git add src/lib/live/flow-view.ts src/lib/live/flow-view.test.ts components/live/GameFlow.tsx hooks/useMediaQuery.ts components/game/WinProbabilityBar.tsx components/live/LiveView.tsx app/dev/live/fixture.ts
git commit -m "feat(live): game-flow chart with the model's win probability

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Rotation clipboard panel

**Files:**
- Create: `components/live/Clipboard.tsx`
- Modify: `components/live/LiveView.tsx`, `app/dev/live/fixture.ts`

**Interfaces:**
- Consumes: `LivePayload.lineups` (Task 6); `LineupState`, `StintPlayer` (Task 1); `formatClock` (Task 1); `Segmented` (`components/ui/segmented.tsx`), `TeamLogo` (`components/ui/team-mark`), `Panel`, `Eyebrow`.
- Produces: `Clipboard({ lineups, lacAbbr, oppAbbr })`; a "Box score | Rotation" switch on `/live` (shown only when `lineups` exists).

Layout (spec §7.2): a header with timeouts, bonus and the current Clippers five's time together and +/-; two short columns of the five players on the floor, each with a stint timer, stint +/-, six foul pips (red when in foul trouble) and a minutes-vs-usual bar (amber, with "heavy"/"light", when flagged); below, tonight's Clippers units by minutes with +/-.

- [ ] **Step 1: The panel**

Create `components/live/Clipboard.tsx`:

```tsx
'use client'

import { cn } from '@/lib/utils'
import { TeamLogo } from '@/components/ui/team-mark'
import { formatClock } from '@/src/lib/live/win-prob'
import type { LineupState, StintPlayer } from '@/src/lib/types/live-state'

const MAX_FOULS = 6

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
const tone = (n: number) => (n > 0 ? 'text-pos' : n < 0 ? 'text-neg' : 'text-dim')

function FoulPips({ pf, trouble }: { pf: number; trouble: boolean }) {
  return (
    <span className="flex items-center gap-[3px]" aria-label={`${pf} fouls${trouble ? ', in foul trouble' : ''}`} role="img">
      {Array.from({ length: MAX_FOULS }, (_, i) => (
        <i key={i} className={cn('block h-1.5 w-1.5 rounded-full', i < pf ? (trouble ? 'bg-neg' : 'bg-mute') : 'bg-white/[0.08]')} />
      ))}
    </span>
  )
}

function MinutesBar({ p }: { p: StintPlayer }) {
  if (p.usual_min === null) {
    return <span className="justify-self-end font-mono text-[11px] tabular-nums text-dim">{p.min.toFixed(1)} min</span>
  }
  const pct = Math.min(100, (p.min / p.usual_min) * 100)
  const note = p.pace === 'over' ? ' · heavy' : p.pace === 'under' ? ' · light' : ''
  return (
    <span className="grid min-w-[120px] justify-items-end gap-1">
      <span className={cn('font-mono text-[11px] tabular-nums', p.pace ? 'text-warn' : 'text-dim')}>
        {p.min.toFixed(1)} of usual {p.usual_min.toFixed(0)} min{note}
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
        <span className={cn('block h-full rounded-full', p.pace ? 'bg-warn' : 'bg-pacific/70')} style={{ width: `${pct}%` }} />
      </span>
    </span>
  )
}

function OnCourt({ abbr, players }: { abbr: string; players: StintPlayer[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-mute">
        <TeamLogo abbr={abbr} size="xs" />
        {abbr} on the floor
      </div>
      {players.length === 0 ? (
        <p className="m-0 text-[13px] text-dim">Waiting for the box score.</p>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {players.map((p) => (
            <li key={p.player_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-[12px] bg-white/[0.03] px-3 py-2">
              <span className="truncate text-[13.5px] font-medium">{p.name}</span>
              <span className="font-mono text-[12px] tabular-nums text-mute" title={`On since ${p.stint_start.clock} of ${p.stint_start.period <= 4 ? `Q${p.stint_start.period}` : 'OT'}`}>
                {formatClock(p.stint_secs)} <span className={tone(p.stint_plus_minus)}>{signed(p.stint_plus_minus)}</span>
              </span>
              <FoulPips pf={p.pf} trouble={p.foul_trouble} />
              <MinutesBar p={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Who's on the floor, for how long, and how it's going (spec §7.2). */
export function Clipboard({ lineups, lacAbbr, oppAbbr }: { lineups: LineupState; lacAbbr: string; oppAbbr: string }) {
  const { timeouts, bonus, current_unit, units_tonight } = lineups
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] tabular-nums text-mute">
        <span>
          Timeouts {lacAbbr} {timeouts.lac ?? '—'} · {oppAbbr} {timeouts.opp ?? '—'}
        </span>
        {bonus.lac && <span className="text-warn">{lacAbbr} in the bonus</span>}
        {bonus.opp && <span className="text-warn">{oppAbbr} in the bonus</span>}
        <span className="sm:ml-auto">
          This {lacAbbr} five: {formatClock(current_unit.secs_together)} together,{' '}
          <span className={tone(current_unit.lac_plus_minus)}>{signed(current_unit.lac_plus_minus)}</span>
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <OnCourt abbr={lacAbbr} players={lineups.on_court.lac} />
        <OnCourt abbr={oppAbbr} players={lineups.on_court.opp} />
      </div>
      {units_tonight.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-mute">{lacAbbr} lineups tonight</div>
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-dim">
              <tr>
                <th className="pb-1 text-left font-normal">Five</th>
                <th className="pb-1 text-right font-normal">Min</th>
                <th className="pb-1 text-right font-normal">+/-</th>
              </tr>
            </thead>
            <tbody>
              {units_tonight.map((u) => (
                <tr key={u.player_ids.join('-')} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-mute">{u.names.join(' · ')}</td>
                  <td className="py-1.5 text-right font-mono">{formatClock(u.secs)}</td>
                  <td className={cn('py-1.5 text-right font-mono', tone(u.plus_minus))}>{signed(u.plus_minus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Box score | Rotation on `/live`**

In `components/live/LiveView.tsx`:
- import `Clipboard` from `./Clipboard` and `Segmented` from `@/components/ui/segmented`;
- at the top of the component (before any early return) add `const [panel, setPanel] = React.useState<'box' | 'rotation'>('box')`;
- replace the box-score column (`<div className="min-w-0">` holding `<Eyebrow aside={pausedNote}>Box score</Eyebrow>` and the `BoxScore`/placeholder) with:

```tsx
        <div className="min-w-0">
          <Eyebrow aside={pausedNote}>{panel === 'rotation' && data.lineups ? 'Rotation' : 'Box score'}</Eyebrow>
          {data.lineups && (
            <Segmented
              className="mb-3"
              size="sm"
              ariaLabel="Box score or rotation"
              value={panel}
              onChange={setPanel}
              options={[
                { value: 'box', label: 'Box score' },
                { value: 'rotation', label: 'Rotation' },
              ]}
            />
          )}
          {panel === 'rotation' && data.lineups ? (
            <Panel className="p-4 sm:p-5">
              <Clipboard lineups={data.lineups} lacAbbr={lac.abbr ?? 'LAC'} oppAbbr={oppAbbr} />
            </Panel>
          ) : data.box_score ? (
            <BoxScore teams={data.box_score.teams} playerIdsAreNba />
          ) : (
            <Panel className="p-6 text-[14px] text-mute">The box score appears after the first stats come in.</Panel>
          )}
        </div>
```

- [ ] **Step 3: Sample lineups for `/dev/live`**

In `app/dev/live/fixture.ts`, add `LineupState` to the `live-state` type import and this helper above `liveFixture`, which builds a sample clipboard from the fixture's own box score so the names match:

```ts
function sampleLineups(p: LivePayload): LineupState {
  const [lacTeam, oppTeam] = p.box_score?.teams ?? []
  const five = (players: BoxScorePlayer[], side: 'lac' | 'opp'): LineupState['on_court']['lac'] =>
    players.slice(0, 5).map((pl, i) => ({
      player_id: Number(pl.player_id) || i + 1,
      name: pl.name,
      stint_start: { period: 3, clock: ['12:00', '11:02', '9:48', '12:00', '10:30'][i] },
      stint_secs: [258, 200, 126, 258, 168][i],
      stint_plus_minus: side === 'lac' ? [4, 3, 1, 4, 2][i] : [-4, -3, -1, -4, -2][i],
      pf: [1, 3, 2, 4, 0][i],
      foul_trouble: i === 3,
      min: [24.1, 22.6, 18.3, 26.0, 15.2][i],
      usual_min: [34, 30, 28, 29, null][i],
      pace: i === 2 ? 'under' : null,
    }))
  const lacNames = (lacTeam?.players ?? []).map((x) => x.name)
  return {
    on_court: { lac: five(lacTeam?.players ?? [], 'lac'), opp: five(oppTeam?.players ?? [], 'opp') },
    current_unit: { lac_plus_minus: 1, secs_together: 126 },
    units_tonight: [
      { player_ids: [1, 2, 3, 4, 5], names: lacNames.slice(0, 5), secs: 842, plus_minus: 9 },
      { player_ids: [1, 2, 4, 6, 7], names: [0, 1, 3, 5, 6].map((i) => lacNames[i] ?? `Player ${i + 1}`), secs: 380, plus_minus: -3 },
    ],
    timeouts: { lac: 4, opp: 3 },
    bonus: { lac: false, opp: true },
  }
}
```

and extend the fixture's final `return` to `return { ...payload, ...sampleFlow(…), lineups: sampleLineups(payload) }` (keeping the `sampleFlow` arguments from Task 8).

- [ ] **Step 4: Check it renders**

Run the Global Constraints verification, then `npm run dev` → `http://localhost:3000/dev/live`: the "Box score | Rotation" switch appears; Rotation shows both fives with stint timers, colored +/-, foul pips (one player's in red), minutes bars (one amber "light"), the header with timeouts and the opponent's bonus, and the units table. Check at 375 px wide that nothing overflows horizontally. Stop the server; restore `AGENTS.md` if `next dev` touched it.

- [ ] **Step 5: Commit**

```bash
git add components/live/Clipboard.tsx components/live/LiveView.tsx app/dev/live/fixture.ts
git commit -m "feat(live): rotation clipboard next to the box score

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Spoiler buffer (pure)

**Files:**
- Create: `src/lib/live/spoiler.ts`, `src/lib/live/spoiler.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SPOILER_BUFFER_MS = 150_000`, `MAX_DELAY_MS = 120_000`, `DELAY_STORAGE_KEY = 'ccc:spoiler-delay-ms'`, `DELAY_PRESETS`, `OFFSET_SAMPLES = 20`, `Frame<T>`, `clampDelay`, `parseStoredDelay`, `addFrame`, `pickFrame`, `syncDelay`, `addOffsetSample`, `clockOffset`, `frameTime`. Task 11 uses all of them.

A **frame** is something the page showed, keyed by `at`: when the real play in it happened, in this device's clock (`observed_at` + clock offset). With a delay `d`, the page renders the newest frame with `at ≤ now − d`. The **clock offset** is device time minus the hub's clock; the smallest recent sample of (receive time − `hub_at`) is the one with the least network delay in it, and a replayed old message only adds a large sample, which the minimum ignores.

- [ ] **Step 1: Write the failing test**

Create `src/lib/live/spoiler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  addFrame,
  addOffsetSample,
  clampDelay,
  clockOffset,
  frameTime,
  OFFSET_SAMPLES,
  parseStoredDelay,
  pickFrame,
  syncDelay,
  type Frame,
} from './spoiler';

const F = (at: number, value: number): Frame<number> => ({ at, value });
const ats = (frames: Frame<number>[]) => frames.map((f) => f.at);

describe('clampDelay / parseStoredDelay', () => {
  it('keeps whole seconds between 0 and 120', () => {
    expect(clampDelay(7_400)).toBe(7_000);
    expect(clampDelay(7_600)).toBe(8_000);
    expect(clampDelay(-5)).toBe(0);
    expect(clampDelay(999_999)).toBe(120_000);
    expect(clampDelay(Number.NaN)).toBe(0);
  });
  it('reads a stored value defensively', () => {
    expect(parseStoredDelay('30000')).toBe(30_000);
    expect(parseStoredDelay(null)).toBe(0);
    expect(parseStoredDelay('abc')).toBe(0);
    expect(parseStoredDelay('500000')).toBe(120_000);
  });
});

describe('addFrame', () => {
  it('keeps frames in play order, even when one arrives late', () => {
    expect(ats(addFrame([F(10, 1), F(30, 3)], F(20, 2), 30))).toEqual([10, 20, 30]);
  });
  it('puts a frame with the same time after the existing one', () => {
    expect(addFrame([F(10, 1)], F(10, 2), 10).map((f) => f.value)).toEqual([1, 2]);
  });
  it('drops frames older than 150 s but keeps the newest of those as a floor', () => {
    const frames = addFrame([F(10_000, 1), F(40_000, 2), F(60_000, 3)], F(190_000, 4), 200_000);
    expect(ats(frames)).toEqual([40_000, 60_000, 190_000]);
  });
});

describe('pickFrame', () => {
  const frames = [F(1_000, 1), F(5_000, 2), F(9_000, 3)];
  it('shows the newest frame at least `delay` old', () => {
    expect(pickFrame(frames, 10_000, 0)?.value).toBe(3);
    expect(pickFrame(frames, 10_000, 2_000)?.value).toBe(2);
    expect(pickFrame(frames, 10_000, 6_000)?.value).toBe(1);
  });
  it('holds (null) while nothing is that old yet', () => {
    expect(pickFrame(frames, 10_000, 9_500)).toBeNull();
    expect(pickFrame([], 10_000, 0)).toBeNull();
  });
});

describe('syncDelay', () => {
  // value = total points on the scoreboard
  const frames = [F(1_000, 10), F(3_000, 10), F(5_000, 12), F(8_000, 12), F(9_000, 15)];
  it('measures from the newest basket at or before the tap', () => {
    expect(syncDelay(frames, 29_000, (v) => v)).toBe(20_000);
    expect(syncDelay(frames, 8_500, (v) => v)).toBe(4_000); // 3.5 s rounds to 4
  });
  it('is null without a basket, or when scores are unknown', () => {
    expect(syncDelay([F(1_000, 10), F(2_000, 10)], 5_000, (v) => v)).toBeNull();
    expect(syncDelay(frames, 29_000, () => null)).toBeNull();
  });
  it('never exceeds the maximum delay', () => {
    expect(syncDelay(frames, 500_000, (v) => v)).toBe(120_000);
  });
});

describe('clock offset', () => {
  it('keeps the last 20 samples and ignores non-numbers', () => {
    let s: number[] = [];
    for (let i = 0; i < 25; i++) s = addOffsetSample(s, i);
    expect(s).toHaveLength(OFFSET_SAMPLES);
    expect(s[0]).toBe(5);
    expect(addOffsetSample(s, Number.NaN)).toBe(s);
  });
  it('uses the smallest sample, 0 before any', () => {
    expect(clockOffset([300, 120, 900])).toBe(120);
    expect(clockOffset([])).toBe(0);
  });
  it('dates a frame by its play, in device time, never later than it arrived', () => {
    const observed = '2026-10-22T02:40:00.000Z';
    const played = Date.parse(observed);
    expect(frameTime(observed, 250, played + 5_000)).toBe(played + 250);
    expect(frameTime(observed, 250, played + 100)).toBe(played + 100);
    expect(frameTime(null, 250, 42)).toBe(42);
    expect(frameTime('not a date', 250, 42)).toBe(42);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/live/spoiler.test.ts`
Expected: FAIL — cannot resolve `./spoiler`.

- [ ] **Step 3: Write the buffer**

Create `src/lib/live/spoiler.ts`:

```ts
// src/lib/live/spoiler.ts
// Spoiler sync (Live v2 spec §7.3). The page keeps what it showed over the
// last 150 s as frames keyed by when the real play happened, in this device's
// clock, and renders the newest frame at least `delay` old — so nothing shows
// before the fan's own TV or stream does. Pure.

export const SPOILER_BUFFER_MS = 150_000;
export const MAX_DELAY_MS = 120_000;
export const DELAY_STORAGE_KEY = 'ccc:spoiler-delay-ms';
export const DELAY_PRESETS = [
  { label: 'Off', ms: 0 },
  { label: 'TV', ms: 8_000 },
  { label: 'Stream', ms: 30_000 },
] as const;
/** Clock-offset samples kept; the smallest wins (it has the least network delay in it). */
export const OFFSET_SAMPLES = 20;

export interface Frame<T> {
  at: number;                  // device-clock ms when the newest play in `value` happened
  value: T;
}

/** Whole seconds, 0–120 s. */
export function clampDelay(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.min(MAX_DELAY_MS, Math.max(0, Math.round(ms / 1000) * 1000));
}

export function parseStoredDelay(raw: string | null): number {
  return raw === null ? 0 : clampDelay(Number(raw));
}

/** Inserts in `at` order and drops frames older than the buffer, keeping the newest of those as a floor. */
export function addFrame<T>(frames: Frame<T>[], frame: Frame<T>, now: number): Frame<T>[] {
  const next = [...frames];
  let i = next.length;
  while (i > 0 && next[i - 1].at > frame.at) i--;
  next.splice(i, 0, frame);
  const cutoff = now - SPOILER_BUFFER_MS;
  let first = 0;
  while (first + 1 < next.length && next[first + 1].at <= cutoff) first++;
  return first === 0 ? next : next.slice(first);
}

/** The newest frame at least `delayMs` old; null while nothing is that old yet. */
export function pickFrame<T>(frames: Frame<T>[], now: number, delayMs: number): Frame<T> | null {
  const limit = now - delayMs;
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].at <= limit) return frames[i];
  return null;
}

/**
 * "Sync to my screen": the fan tapped as their screen showed a basket. The
 * newest frame at or before the tap whose total score went up is that basket;
 * the delay is how long ago it happened. Null when no basket is buffered.
 */
export function syncDelay<T>(frames: Frame<T>[], tapAt: number, totalScore: (v: T) => number | null): number | null {
  for (let i = frames.length - 1; i > 0; i--) {
    if (frames[i].at > tapAt) continue;
    const after = totalScore(frames[i].value);
    const before = totalScore(frames[i - 1].value);
    if (after !== null && before !== null && after > before) return clampDelay(tapAt - frames[i].at);
  }
  return null;
}

export function addOffsetSample(samples: number[], sample: number): number[] {
  if (!Number.isFinite(sample)) return samples;
  return [...samples, sample].slice(-OFFSET_SAMPLES);
}

/** Device clock minus the hub's clock (plus the least network delay seen); 0 before any sample. */
export function clockOffset(samples: number[]): number {
  return samples.length ? Math.min(...samples) : 0;
}

/** When the newest play in a state happened, in device time; never later than it arrived. */
export function frameTime(observedAt: string | null | undefined, offset: number, receivedAt: number): number {
  const played = observedAt ? Date.parse(observedAt) : Number.NaN;
  return Number.isFinite(played) ? Math.min(receivedAt, played + offset) : receivedAt;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/live/spoiler.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification and commit**

Run the Global Constraints verification.

```bash
git add src/lib/live/spoiler.ts src/lib/live/spoiler.test.ts
git commit -m "feat(live): spoiler-sync frame buffer, delay pick and screen sync

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Spoiler sync on `/live`

**Files:**
- Modify: `hooks/useLiveStream.ts`, `components/live/LiveView.tsx`, `app/live/page.tsx`
- Create: `components/live/SpoilerControl.tsx`

**Interfaces:**
- Consumes: everything in `src/lib/live/spoiler.ts` (Task 10); `overlayLiveDoc` (`src/lib/live/payload.ts`); `Segmented`.
- Produces: `SpoilerState = { delayMs: number; setDelay(ms: number): void; sync(): number | null; holding: boolean }` exported from `hooks/useLiveStream.ts`; `LiveStream.spoiler`; `LiveView` prop `spoiler?: SpoilerState`; `SpoilerControl({ spoiler })`.

How it works:
- **Frames from push.** Every message the socket applies (including the hub's replay of the last ~150 s on connect) adds a frame holding that `LiveStateDoc`, at `frameTime(doc.observed_at, offset, receivedAt)`. Each message with `hub_at` adds a clock-offset sample.
- **Frames from the page.** Every new on-screen payload (poll tier, ESPN backup, or push overlay) adds a frame holding that `LivePayload`: at its `observed_at` in device time, or at `now` for an ESPN backup overlay (ESPN has no play time).
- **Rendering.** With a delay set, the hook picks the newest push frame at least `delay` old and overlays it on the current `/api/live` base while push is live, or else the newest page frame at least `delay` old. Nothing old enough → `holding`, and the page shows a hold panel instead of a newer score. With no delay the hook behaves exactly as today.
- Everything on the page — scoreboard, sticky score, tab title, flow chart, clipboard, insights — reads that one payload, so nothing can leak a play early.
- The delay lives in `localStorage` (`ccc:spoiler-delay-ms`). It's read in the `useState` initializer (no effect). `holding` stays false until `useNow` has mounted, so the first client render matches the server's.
- React 19 lint rules in this repo forbid reading refs and calling `Date.now()` during render: frames and the offset live in **state**, updated from the socket's message handler and with the "store information from previous renders" pattern the hook already uses for `followChip`; render code uses `now` from `useNow`.

- [ ] **Step 1: Extend the hook**

In `hooks/useLiveStream.ts`:

1. Add imports:

```ts
import {
  addFrame,
  addOffsetSample,
  clampDelay,
  clockOffset,
  DELAY_STORAGE_KEY,
  frameTime,
  parseStoredDelay,
  pickFrame,
  syncDelay,
  type Frame,
} from '@/src/lib/live/spoiler'
```

2. Add the types after `LatencySample`, and a `spoiler` field on `LiveStream`:

```ts
export interface SpoilerState {
  /** 0 = off. */
  delayMs: number
  setDelay(ms: number): void
  /** Sets the delay from the newest buffered basket; returns it, or null if none is buffered. */
  sync(): number | null
  /** A delay is set but nothing that old is buffered yet: show a hold state, not a newer score. */
  holding: boolean
}

type Frames<T> = { gameId: string; list: Frame<T>[] } | null

function withFrame<T>(frames: Frames<T>, gameId: string, frame: Frame<T>, now: number): Frames<T> {
  return { gameId, list: addFrame(frames && frames.gameId === gameId ? frames.list : [], frame, now) }
}
```

```ts
export interface LiveStream {
  data: LivePayload | undefined
  error: unknown
  source: FeedSource
  latency: LatencySample | null
  spoiler: SpoilerState
}
```

3. At the top of `useLiveStream`, replace `const now = useNow(5_000)?.getTime() ?? null` with:

```ts
  const [delayMs, setDelayMs] = React.useState(() => {
    if (typeof window === 'undefined') return 0
    try {
      return parseStoredDelay(window.localStorage.getItem(DELAY_STORAGE_KEY))
    } catch {
      return 0
    }
  })
  const setDelay = React.useCallback((ms: number) => {
    const v = clampDelay(ms)
    setDelayMs(v)
    try {
      window.localStorage.setItem(DELAY_STORAGE_KEY, String(v))
    } catch {
      // Private mode or blocked storage: the delay just won't persist.
    }
  }, [])
  // A delayed page steps through its buffer once a second.
  const now = useNow(delayMs > 0 ? 1_000 : 5_000)?.getTime() ?? null
  const [pushFrames, setPushFrames] = React.useState<Frames<LiveStateDoc>>(null)
  const [pageFrames, setPageFrames] = React.useState<Frames<LivePayload>>(null)
  const [offset, setOffset] = React.useState(0)
```

4. In the push effect, declare `let samples: number[] = []` next to `let attempt = 0`, and in `socket.onmessage`, right after `setPushed({ gameId, doc: result.state })`, add:

```ts
        const receivedAt = Date.now()
        if (typeof msg.hub_at === 'number') {
          samples = addOffsetSample(samples, receivedAt - msg.hub_at)
          setOffset(clockOffset(samples))
        }
        const doc = result.state
        const at = frameTime(doc.observed_at, clockOffset(samples), receivedAt)
        setPushFrames((f) => withFrame(f, gameId, { at, value: doc }, receivedAt))
```

(The existing `setLatency` call can use `receivedAt` for `received_at`.)

5. After the `shown` memo, record page frames and apply the delay:

```ts
  // Record each new on-screen payload (the "store information from previous
  // renders" pattern, like followChip above).
  // Waits for useNow to mount, so the first payload isn't skipped.
  const [seenShown, setSeenShown] = React.useState<LivePayload | undefined>(undefined)
  if (shown.data !== seenShown && now !== null) {
    setSeenShown(shown.data)
    const d = shown.data
    if (gameId && d?.game) {
      const at = shown.usedBackup ? now : frameTime(d.observed_at, offset, now)
      setPageFrames((f) => withFrame(f, gameId, { at, value: d }, now))
    }
  }

  let out = shown.data
  let holding = false
  if (delayMs > 0 && now !== null && gameId && shown.data?.game) {
    if (pushLive && base && pushFrames?.gameId === gameId) {
      const f = pickFrame(pushFrames.list, now, delayMs)
      if (f) out = overlayLiveDoc(base, f.value)
      else holding = true
    } else {
      const f = pageFrames?.gameId === gameId ? pickFrame(pageFrames.list, now, delayMs) : null
      if (f) out = f.value
      else holding = true
    }
  }

  const sync = React.useCallback((): number | null => {
    const tap = Date.now()
    const d =
      pushLive && pushFrames?.gameId === gameId
        ? syncDelay(pushFrames.list, tap, (doc) => doc.home_score + doc.away_score)
        : pageFrames?.gameId === gameId
          ? syncDelay(pageFrames.list, tap, (p) => (p.game ? (p.game.home.score ?? 0) + (p.game.away.score ?? 0) : null))
          : null
    if (d !== null) setDelay(d)
    return d
  }, [pushLive, pushFrames, pageFrames, gameId, setDelay])
```

6. Return the delayed payload and the spoiler state:

```ts
  return {
    data: holding ? undefined : out,
    error,
    source: pickSource({
      shown: shown.data,
      pushFetchedAt: pushLive && pushDoc ? pushDoc.fetched_at : null,
      now: now ?? 0,
      backup: shown.usedBackup,
    }),
    latency,
    spoiler: { delayMs, setDelay, sync, holding },
  }
```

(`source` keeps describing the live feed, not the delayed frame.)

If `npm run lint` flags one of these patterns anyway, fix it the way the rule's documentation recommends and note it in the report — don't disable the rule.

- [ ] **Step 2: The control**

Create `components/live/SpoilerControl.tsx`:

```tsx
'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Segmented } from '@/components/ui/segmented'
import { DELAY_PRESETS, MAX_DELAY_MS } from '@/src/lib/live/spoiler'
import type { SpoilerState } from '@/hooks/useLiveStream'

/** Hold /live back to match the fan's TV or stream (spec §7.3). */
export function SpoilerControl({ spoiler }: { spoiler: SpoilerState }) {
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState<string | null>(null)
  const secs = Math.round(spoiler.delayMs / 1000)
  const preset = DELAY_PRESETS.find((p) => p.ms === spoiler.delayMs)

  const sync = () => {
    const d = spoiler.sync()
    setNote(d === null ? 'No basket in the last two minutes yet. Try again after the next one.' : `Synced: ${Math.round(d / 1000)} s behind live.`)
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-line-2 px-3 py-1 font-mono text-[11.5px] transition-colors hover:border-pacific/60',
          secs > 0 ? 'text-text' : 'text-mute',
        )}
      >
        Spoiler delay · {secs > 0 ? `${secs} s` : 'Off'}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-[min(320px,calc(100vw-32px))] rounded-[16px] border border-line-2 bg-ink-2/95 p-4 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)] backdrop-blur">
          <p className="m-0 mb-3 text-[12.5px] text-mute">Hold this page back so nothing shows before your TV or stream does.</p>
          <Segmented
            size="sm"
            ariaLabel="Delay preset"
            value={preset ? String(preset.ms) : 'custom'}
            options={DELAY_PRESETS.map((p) => ({ value: String(p.ms), label: p.ms ? `${p.label} ${p.ms / 1000}s` : p.label }))}
            onChange={(v) => {
              setNote(null)
              spoiler.setDelay(Number(v))
            }}
          />
          <label className="mt-3 grid gap-1.5 font-mono text-[11px] text-dim">
            Delay {secs} s
            <input
              type="range"
              min={0}
              max={MAX_DELAY_MS / 1000}
              step={1}
              value={secs}
              onChange={(e) => {
                setNote(null)
                spoiler.setDelay(Number(e.target.value) * 1000)
              }}
              className="accent-[var(--pacific)]"
            />
          </label>
          <button
            type="button"
            onClick={sync}
            className="mt-3 w-full rounded-full bg-pacific px-4 py-2 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110"
          >
            Sync to my screen
          </button>
          <p className="m-0 mt-2 text-[11.5px] text-dim" aria-live="polite">
            {note ?? 'Tap it the moment your screen shows a basket.'}
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Wire the page**

In `app/live/page.tsx`, destructure `spoiler` from `useLiveStream()` and pass it: `<LiveView data={data} error={error} source={source} spoiler={spoiler} />`.

In `components/live/LiveView.tsx`:
- import `SpoilerControl` from `./SpoilerControl` and `type { SpoilerState }` from `@/hooks/useLiveStream`;
- add `spoiler?: SpoilerState` to the props;
- right after the `if (error && !data)` block and **before** `if (!data)`, add the hold state:

```tsx
  if (spoiler?.holding) {
    return (
      <div className="page">
        <Panel className="grid justify-items-start gap-3 p-6">
          <p className="m-0 text-[14px] text-mute">
            Holding the game {Math.round(spoiler.delayMs / 1000)} s behind live to match your screen…
          </p>
          <SpoilerControl spoiler={spoiler} />
        </Panel>
      </div>
    )
  }
```

- replace the `{source && (<div className="mt-3 flex justify-end"><FeedSource source={source} /></div>)}` block with:

```tsx
        {(source || spoiler) && (
          <div className="mt-3 flex items-center justify-between gap-3">
            {spoiler ? <SpoilerControl spoiler={spoiler} /> : <span />}
            {source && <FeedSource source={source} />}
          </div>
        )}
```

- [ ] **Step 4: Verify**

Run the Global Constraints verification.

Dev check (no live game needed for the control; the delay itself is exercised at the preseason game in Task 12):
1. `npm run dev`, open `http://localhost:3000/live` → the idle state renders as before (no control without a game).
2. In the browser console on that page run `localStorage.setItem('ccc:spoiler-delay-ms', '8000')` and reload → the idle page still renders; there are no hydration warnings in the console.
3. Clear it: `localStorage.removeItem('ccc:spoiler-delay-ms')`.

Stop the server; restore `AGENTS.md` if `next dev` touched it.

- [ ] **Step 5: Commit**

```bash
git add hooks/useLiveStream.ts components/live/SpoilerControl.tsx components/live/LiveView.tsx app/live/page.tsx
git commit -m "feat(live): spoiler sync — hold the page to the fan's TV or stream

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Rollout (operational — needs Luke at the marked steps)

- [ ] **Step 1: Fit the model against production (read-only).** From the worktree, with the main checkout's env file:

```bash
node --env-file="/Users/luke/Claude Projects/CCC/.env.local" node_modules/.bin/tsx scripts/calibrate-wp.ts --dry
```

Expected: the game count (≈1,300), σ within 10–16, a Brier score around 0.15–0.19, and a reliability table whose "actual" column tracks "predicted" within a few points. If σ lands on a grid edge (8 or 18), stop and investigate before storing.

- [ ] **Step 2: Store it (production write — Luke's go-ahead).** The same command without `--dry`. After that, `post-game.yml` refits nightly.

- [ ] **Step 3: Ship.** Push `live/v2-plan3`, open the PR, wait for checks, merge (Luke's standing rule: Claude merges its own PRs once checks pass). Confirm the production deploy and that `/api/live` still answers.

- [ ] **Step 4: Preseason game (Oct 3–20) — with Luke.**
  - The runner's log line shows the model: `Win prob: E … (spread|home_court), σ …`.
  - `/live`: the flow chart grows with each basket and the WP line moves; the scoreboard bar says "model estimate"; the Rotation tab shows both fives with stint timers counting between updates and fouls matching the box score.
  - Spoiler sync: set "TV 8s" while watching the broadcast, then "Sync to my screen" on a basket. The score, tab title and sticky score should change when the TV shows the basket, not before.
  - `wrangler tail` shows deltas carrying `flow_append` (a few hundred bytes), not the whole series.
  - Runner-not-started: if a game night's runner is late, `/live` should show the game with "Our live feed hasn't started" and ESPN's score, not "no game".

- [ ] **Step 5: Next-morning budget check.** Neon storage (`live_state` rows are ~1–2 KB larger per game), Cloudflare DO requests and Vercel edge requests against the spec's §3/§5/§6 budgets.

## Plan series

1. **Plan 1 — runner** (merged): adaptive cadence, `live_state`, CDN-cached `/api/live`.
2. **Plan 2 — push hub** (merged): Cloudflare Durable Object fan-out, three-tier stream client, ESPN backup.
3. **Plan 3 — features** (this plan): game flow + calibrated WP, rotation clipboard, spoiler sync, runner-not-started coverage.
4. **Next spec:** catch-me-up (the hub replay already delivers it), web push alerts (each respecting its subscription's spoiler delay), shot chart, and the Tier 2 ideas.
