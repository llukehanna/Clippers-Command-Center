# Insights Engine v2 — Design Spec

*2026-09-27 · branch `insights/espn-engine` (from `main` @ c15f2cf)*

## Goal

Turn the insights engine from "reports what is true" into "reports why it is interesting", at the level of ESPN Stats & Info: every claim carries a reference frame ("first since…", "most by a Clipper in…", "only player to…"), insights are ranked by real newsworthiness, and they appear everywhere a fan looks — live, pregame, postgame, season, player pages. Alongside it, add a News page with article links and the hottest Clippers social posts.

The current engine's foundation stays: every insight stores its proof SQL, parameters and result; stale claims are deactivated; `verify-insights` re-runs proofs. What changes is how claims are produced, framed, scored, rendered and surfaced.

**Success looks like:**

- Every insight on Home, game pages and player pages has a frame beyond a bare rank ("ranked Nth") — or it is a standings/rank fact that is itself notable (top/bottom 5).
- No trivial claims: nothing a subject does in more than 25% of their games is shown, unless it is a milestone or record.
- Postgame insights appear within 10 minutes of the final buzzer.
- Live replay of five 2025-26 Clippers games yields 6–20 live insights per game, all passing the golden rules.
- `verify-insights` passes 100% on batch insights; live proofs pass post-game re-verification.
- News page shows articles and social posts refreshed every 15 minutes, with zero recurring cost.

## Decisions (from Luke)

| Decision | Choice |
|---|---|
| Scope | **Everything in one spec**: engine core, live, postgame, pregame, player pages, presentation, news/social |
| Architecture | **Fact → Frame → Score → Render pipeline + materialized record book**; live generation moves into the game-night runner |
| Data depth | **Deeper box scores + play-by-play**: league-wide game logs back to 1996-97; play-by-play for Clippers games |
| Copy | **Templates only**: multiple hand-written phrasings per claim type, no LLM |
| Cards | **Evidence visual + receipts**: headline, context line, small visual, headshot/logo, links, expandable proof drawer |
| News/social | **Must be free**: RSS for articles; r/LAClippers "hot" posts with X posts rendered via X's free embed; Bluesky public search as secondary |

## Principles (unchanged from PROJECT.md, restated because they constrain every choice)

1. **Provable only.** Every insight row has `proof_sql`, `proof_params`, a non-empty `proof_result`. Live insights included (the current live proofs query a non-existent table; this spec fixes that).
2. **Honest reference frames.** Claims never exceed the data. The framer knows where records begin and says "since 1996-97" / "in 30 seasons of records", never "franchise history", unless the data covers the whole franchise.
3. **Clippers-first.** League data is context for Clippers facts, never the subject.
4. **External content never borrows credibility.** News and social are visually and structurally separate from verified insights.

---

## 1. Data layer

### 1.1 Deep history backfill (one-time, local)

- **Source:** stats.nba.com `leaguegamelog` (`PlayerOrTeam=P` and `=T`), one request per season per type, seasons 1996-97 → 2021-22 (~52 requests). 2022-23 onward is already loaded from cdn.nba.com.
- **Runs locally** on Luke's machine (`npm run backfill-history`): stats.nba.com blocks cloud IPs. Reuses the stats.nba.com headers in `scripts/lib/nba-live-client.ts`.
- **First step is a probe** (one season); if stats.nba.com refuses the local IP too, stop — records start at 2022-23 and every frame adapts automatically (see `records_start` below).
- **Storage:** rows go into the existing `games`, `game_team_box_scores`, `game_player_box_scores` with `raw_payload = NULL` and a new `source` column (`'cdn' | 'stats_gamelog'`). Unknown players are inserted into `players` by NBA person id; team ids resolve by NBA team id (relocated franchises keep their id).
- **Budget:** DB is 228 MB today; `game_player_box_scores` is 126 MB for 4 seasons, mostly `raw_payload`. Slim historical rows are ~150 B + indexes → ~120 MB for 26 seasons. The backfill runs newest-first and **pauses at 2010-11** to report DB size before continuing; if Neon's plan limit is ≤ 0.5 GB it stops there.
- **Derived-stat scope:** `compute-stats` keeps computing `advanced_team_game_stats` for all seasons (cheap), but `advanced_player_game_stats`, `rolling_player_stats`, `rolling_team_stats` stay limited to seasons ≥ 2022 (`FULL_STATS_START`). These are the expensive tables and insights don't need them for old seasons.
- **`records_start`**: stored in `app_kv` (`insights.records_start = {season_id, label}`) after backfill — the first season with complete league-wide box scores. The framer reads it; nothing is hard-coded.

### 1.2 Play-by-play (Clippers games)

- **Sources:** cdn.nba.com `playbyplay_{gameId}.json` for current games (the game-night runner already polls cdn.nba.com) and for 2022-23+; stats.nba.com `playbyplayv3` locally for 1996-97 → 2021-22 Clippers games (~2,200 requests, rate-limited, resumable via `app_kv` checkpoint).
- **Parser** normalizes both formats into one event shape: `{event_num, period, clock_sec_remaining, elapsed_sec, team_id, player_id, action, points, score_home, score_away}`.
- **Derived tables (kept for all seasons):**

```sql
CREATE TABLE game_flow (
  game_id            BIGINT PRIMARY KEY REFERENCES games(game_id),
  lac_largest_lead   SMALLINT NOT NULL,
  lac_largest_deficit SMALLINT NOT NULL,   -- positive number of points
  lead_changes       SMALLINT NOT NULL,
  times_tied         SMALLINT NOT NULL,
  lac_best_run       SMALLINT NOT NULL,    -- unanswered points
  opp_best_run       SMALLINT NOT NULL,
  comeback_margin    SMALLINT,             -- = lac_largest_deficit when LAC won, else NULL
  margin_series      JSONB NOT NULL,       -- [[elapsed_sec, lac_margin], ...] per scoring event
  source             TEXT NOT NULL         -- 'cdn' | 'stats_pbp'
);

CREATE TABLE period_team_stats (
  game_id BIGINT, team_id BIGINT, period SMALLINT,
  pts SMALLINT, fgm SMALLINT, fga SMALLINT, fg3m SMALLINT, fg3a SMALLINT,
  ftm SMALLINT, fta SMALLINT, reb SMALLINT, ast SMALLINT, tov SMALLINT,
  PRIMARY KEY (game_id, team_id, period)
);

CREATE TABLE period_player_stats (
  game_id BIGINT, player_id BIGINT, team_id BIGINT, period SMALLINT,
  pts SMALLINT, reb SMALLINT, ast SMALLINT, fg3m SMALLINT, fgm SMALLINT, fga SMALLINT,
  stl SMALLINT, blk SMALLINT,
  PRIMARY KEY (game_id, player_id, period)
);

-- Clutch = last 5:00 of the 4th/OT with the margin ≤ 5 before the event (NBA definition).
-- player_id NULL = team row.
CREATE TABLE clutch_stats (
  game_id BIGINT, team_id BIGINT, player_id BIGINT,
  pts SMALLINT, fgm SMALLINT, fga SMALLINT, fg3m SMALLINT, ftm SMALLINT, fta SMALLINT, tov SMALLINT,
  UNIQUE (game_id, team_id, player_id)
);
```

- **Raw events** (`pbp_events`, same normalized shape + `description`) are kept only for the current season, for live receipts and replay; pruned at season rollover. Exception: the 5 games used for live replay tuning (§5.3) are kept.

### 1.3 Record book (nightly)

Built by `npm run build-record-book` after `compute-stats`. Full rebuild each night (it is small).

```sql
CREATE TABLE rb_game_highs (
  scope      TEXT NOT NULL,   -- 'lac_team' | 'lac_player' | 'player_career' | 'player_season' | 'league_season'
  scope_id   TEXT NOT NULL,   -- '' | player_id | season_id | player_id:season_id
  stat_key   TEXT NOT NULL,   -- 'pts','reb','ast','fg3m','stl','blk','team_pts','team_fg3m','margin',
                              -- 'opp_pts_low','q_pts','half_pts','team_q_pts', ...
  rank       SMALLINT NOT NULL,   -- 1..25
  value      NUMERIC NOT NULL,
  game_id    BIGINT NOT NULL,
  game_date  DATE NOT NULL,
  player_id  BIGINT,
  team_id    BIGINT,
  PRIMARY KEY (scope, scope_id, stat_key, rank)
);

CREATE TABLE rb_streaks (
  entity_type TEXT NOT NULL,     -- 'player' | 'team'
  entity_id   BIGINT NOT NULL,
  streak_key  TEXT NOT NULL,     -- 'scoring_20','scoring_30','rebounding_10','threes_3','hot_shooting','wins','losses', ...
  length      SMALLINT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  start_game_id BIGINT NOT NULL,
  end_game_id BIGINT NOT NULL,
  is_active   BOOLEAN NOT NULL,
  team_id     BIGINT,            -- team the player was on (streaks break on team change)
  PRIMARY KEY (entity_type, entity_id, streak_key, start_game_id)
);
-- Only streaks of length >= the streak's minimum are stored.
```

"Last occurrence" and "count" questions are answered with indexed queries over box scores (Clippers player-games all-time are ~32k rows; add `(team_id, game_id)` and per-stat partial indexes where the plan shows a need). The record book exists for top-N and streak history, which are expensive to compute on demand.

### 1.4 News and social ingest

```sql
CREATE TABLE media_items (
  media_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL,          -- 'article' | 'reddit' | 'tweet' | 'bluesky'
  source       TEXT NOT NULL,          -- 'ESPN', 'LA Times', 'Clips Nation', 'NBA.com', 'Google News', 'r/LAClippers', 'Bluesky'
  url          TEXT NOT NULL,
  dedup_key    TEXT NOT NULL UNIQUE,   -- normalized title (articles) or canonical post URL
  title        TEXT NOT NULL,
  author       TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  engagement   INTEGER,                -- reddit score / bluesky likes+reposts
  comments     INTEGER,
  thumbnail_url TEXT,
  embed_url    TEXT,                   -- x.com status URL when a reddit post links to one
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_kind_published ON media_items (kind, published_at DESC);
```

- **`npm run sync-media`**, GitHub Actions cron every 15 minutes (repo is public → unlimited minutes).
- **Articles:** RSS from ESPN (Clippers), LA Times (Clippers), Clips Nation, NBA.com (Clippers), Google News query `"LA Clippers"`. Dedup by normalized title (lowercase, strip source suffix and punctuation); first-seen source wins, Google News items lose ties to direct sources.
- **Reddit:** r/LAClippers `hot` via a free Reddit "script" app (OAuth client credentials; env `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` as Actions secrets). Stickied posts and game threads excluded. Posts whose URL is an `x.com`/`twitter.com` status become `kind='tweet'` with `embed_url` set; others stay `kind='reddit'`.
- **Bluesky:** `app.bsky.feed.searchPosts?q=clippers&sort=top` via an authenticated session (`com.atproto.server.createSession` with a free app password; env `BSKY_HANDLE`, `BSKY_APP_PASSWORD` as Actions secrets; skipped when unset). The public AppView returns 403 for unauthenticated search. Last 24 h, min 10 likes.
- **Retention:** items older than 7 days deleted each run.
- **First task verifies** Reddit and Bluesky from Actions (both returned 403 from the dev sandbox, which blocks outbound requests). If either fails for real, ship without it and flag.

---

## 2. Engine

All engine code lives under `scripts/lib/insights/engine/` (generation time only). Types the UI needs (`Frame`, `Evidence`, `EntityRef`) live in `src/lib/insights/types.ts` and are imported by both sides.

### 2.1 Facts

```ts
type Surface = 'live' | 'pregame' | 'postgame' | 'season' | 'player';

interface Fact {
  kind: string;                    // 'player_game_stat' | 'team_game_stat' | 'player_period_stat' | 'streak'
                                   // | 'milestone' | 'league_rank' | 'yoy_change' | 'standings' | 'game_flow'
                                   // | 'h2h' | 'rest' | 'line' | 'pace' | 'watch' ...
  surface: Surface;
  subject: { type: 'player' | 'team'; id: string; name: string };
  stat: string;                    // stat_key, e.g. 'pts', 'half_pts', 'scoring_20'
  value: number;
  window: { type: 'game' | 'period' | 'half' | 'streak' | 'season' | 'last_n' | 'career';
            game_id?: string; period?: number; season_id?: number; n?: number };
  context: { opponent_id?: string; date: string; home?: boolean; result?: 'W' | 'L' };
  polarity: 'positive' | 'negative' | 'neutral';
  proof: { sql: string; params: unknown[]; rows: unknown[] };   // the fact's own proof
  asOf: string;                    // cutoff date the detector ran with (replay support)
}
```

Detectors are pure-ish functions `(ctx: EngineContext) => Promise<Fact[]>`. `EngineContext` carries `asOf` (a date cutoff every query applies — `game_date <= asOf`), `records_start`, the Clippers team, the stats season and the preloaded caches.

### 2.2 Detectors by surface

| Surface | Detectors |
|---|---|
| **postgame** (each final Clippers game in the last 3 days) | every Clippers player stat line (pts, reb, ast, fg3m, stl, blk, combos like 30-10, triple-double); team stat line (pts, fg3m, FG%, margin, opponent pts); `game_flow` (comeback, largest lead, best run, lead changes); period/half bests from `period_*`; clutch lines; milestones crossed in this game |
| **season** | the six current generators rewritten as detectors: streaks, milestones, league ranks (team + player), standings, year-over-year, recent form |
| **pregame** (next Clippers game) | opponent win/loss streak and last-10; opponent's players on hot streaks (from `rb_streaks` active); Clippers players' career numbers vs this opponent (min 5 games); rest and back-to-back for both teams; line and total from `odds_snapshots`; H2H and last meeting (existing) |
| **player** (current roster) | season/career highs this season, active streaks, milestone progress (career and season thresholds), league ranks, YoY change |
| **live** | see §4 |

Rare-event detection (top 1% league-wide nights) is subsumed: a postgame fact whose best frame is `league_season` rank ≤ 10 carries the same message with a better sentence.

### 2.3 Framer

For each fact, the framer asks a fixed set of questions against the record book and box scores (with `asOf` applied, and excluding the fact's own game):

| Question | Produces frame type |
|---|---|
| Is it the subject's career high? (only if the career lies fully inside records) | `career_high` |
| Has anyone else in the reference set done it? count ≤ 3 → name them | `only_one` / `joins_company` |
| When did the subject/team/any Clipper last reach this value? | `first_since` (with years elapsed) |
| Rank in Clippers history / this season / the league this season | `clippers_rank`, `season_high`, `league_rank` |
| How many times this season? | `nth_time` |
| Milestone threshold crossed / remaining | `milestone` |
| Longest streak of this kind since… (from `rb_streaks`) | `longest_since` |

`career_complete` = the player's first recorded game is after the first season of records (so a player who debuted in 1996-97 is treated as incomplete). When a `first_since` or `longest_since` search reaches `records_start` without a hit, the frame becomes `records_best` ("the most by a Clipper in 30 seasons of records").

**Frame strength** (0–1; the framer keeps the strongest; ties → more specific subject wins):

| Frame | Strength |
|---|---|
| `career_high` | 1.00 |
| `only_one` | 0.95 |
| `records_best` | 0.90 |
| `first_since` / `longest_since` ≥ 10 yrs | 0.90 |
| `league_rank` = 1 (season) | 0.85 |
| `first_since` ≥ 5 yrs | 0.80 |
| `milestone` | 0.70 + 0.05 per threshold step (cap 0.9) |
| `league_rank` ≤ 5 / `joins_company` | 0.70 |
| `first_since` ≥ 2 yrs | 0.65 |
| `season_high` (Clippers or player) | 0.60 |
| `first_since` < 2 yrs | 0.50 |
| `nth_time` | 0.40 |
| none | 0.20 |

A frame carries its own proof query + rows, which are appended to the fact's proof. The stored `proof_sql` becomes a single statement combining the fact query and frame query (as a `WITH fact AS (...), frame AS (...) SELECT ...`), so `verify-insights` keeps its one-query-per-insight contract.

### 2.4 Scorer

```
p         = empirical probability of the fact for this subject
            = (k + α·p_ref) / (n + α),  α = 10
            k/n = occurrences / opportunities in the subject's last 2 seasons (games played)
            p_ref = same rate across all Clippers player-games (or all team-games) in records
rarity    = clamp(-log10(p) / 3, 0, 1)                # p = 0.001 → 1.0
base      = 0.6·rarity + 0.4·frame_strength
salience  = 1.0 current roster, ≥ 20 mpg · 0.8 other current roster · 0.9 team facts
            · 0.5 former players (game-page surface only; excluded elsewhere)
recency   = exp(-ln2 · age_days / half_life)          # half-life: postgame 3d, season 14d, player 21d,
                                                      #  pregame 1.0 until tip then 0, live n/a
polarity  = 1.0 positive/neutral · 0.8 negative
novelty   = +0.10 within 48 h of first emission or a newly crossed threshold
            −0.02 per day unchanged after day 14, floor −0.20
importance = clamp(round(100 · (base · salience · recency · polarity + novelty)), 0, 100)
```

**Triviality filter:** drop the fact when `p > 0.25` unless its frame is `career_high`, `records_best`, `only_one` or `milestone`. Milestones and records are always news.

All weights are initial values, tuned with the replay harness (§5.3). `score_parts` stores every term for debugging.

### 2.5 Renderer (templates)

- `scripts/lib/insights/engine/templates/*.ts`: one module per fact kind, exporting phrasings keyed by frame type. Each phrasing is a function `(fact, frame) => { headline, context }`.
- 2–4 phrasings per (kind, frame); choice = `hash(dedup_key) mod n`, so a claim's wording is stable across nightly runs.
- Headline ≤ 90 characters (enforced; a template that overflows falls back to its shortest variant, then fails the test suite).
- Tense comes from `ctx.season.isCurrent` and the surface (live: present progressive; postgame: past; season: present perfect) — the existing "this season" / "in 2025-26" logic moves here.
- Numbers: shared `fmt`/`pct`/`ordinal` from `proof-utils.ts`; dates as "Dec 28, 2025"; spans as "since Mar 2021".

Example (illustrative — values here are placeholders, not verified data):

| Fact + frame | Headline | Context |
|---|---|---|
| player_game_stat pts=41, first_since 6 yrs | Kawhi Leonard scores 41 in win over Denver | First 40-point game by a Clipper vs. Denver since Mar 2020 |
| streak scoring_20 len=12, longest_since 8 yrs | Kawhi Leonard: 20+ points in 12 straight | Longest streak by a Clipper since 2017-18 |
| game_flow comeback 22, records_best | Clippers erase a 22-point deficit | Largest comeback win in 30 seasons of records |

### 2.6 Evidence spec

```ts
type Evidence =
  | { type: 'streak_strip'; games: { date: string; value: number; hit: boolean }[]; threshold: number }
  | { type: 'rank_track'; rank: number; total: number; betterIsHigher: boolean; label: string }
  | { type: 'history_ladder'; current: { value: number; label: string };
      others: { value: number; label: string; date: string }[] }            // top 5 on record
  | { type: 'delta'; before: { value: number; label: string }; after: { value: number; label: string };
      betterIsHigher: boolean }
  | { type: 'milestone_progress'; current: number; target: number; label: string }
  | { type: 'margin_spark'; series: [number, number][]; highlight?: { from: number; to: number } };
```

Every evidence spec also produces an `aria` summary string at render time.

### 2.7 Composer

Per surface, from active insights ordered by `importance`:

- Max 2 items per player, max 2 per category, ≥ 1 team item when one exists above importance 40.
- **Merge rule:** two postgame facts about the same player in the same game merge into one insight ("41 and 9 — his first 40-point, 9-rebound game since …"); the merged headline uses the stronger frame, the context line lists the other.
- **Feed sizes:** Home hero 1 · Last game 3 · Up next 3 · Season feed 12 · Game page 8 · Player page 6 · Live unlimited (rate-limited, §4).
- Composed feeds are computed at request time in the data loaders (cheap: a few dozen rows per surface), not stored.

### 2.8 Storage changes

```sql
ALTER TABLE insights
  ADD COLUMN surface          TEXT,          -- 'live' | 'pregame' | 'postgame' | 'season' | 'player'
  ADD COLUMN frame            JSONB,         -- { type, strength, text, proof_rows }
  ADD COLUMN evidence         JSONB,
  ADD COLUMN entities         JSONB,         -- [{ type: 'player'|'team'|'game', id, name }]
  ADD COLUMN score_parts      JSONB,
  ADD COLUMN first_emitted_at TIMESTAMPTZ;
CREATE INDEX idx_insights_active_surface ON insights (is_active, surface, importance DESC);
```

- `scope` stays (existing API callers keep working): season/player/pregame → `between_games`, postgame → `historical`, live → `live`.
- `first_emitted_at` is set on insert and never updated (novelty uses it). `detail` holds the context line.
- Dedup key (`proof_hash` via `makeInsightKey`) now includes `surface`; category values are extended with the new fact kinds.
- The six legacy categories' rows are deactivated on the first v2 run (clean cut, no dual-write).

---

## 3. Surfaces and UI

### 3.1 Placement

| Surface | Where | Content |
|---|---|---|
| **Home** (`/home`) | Hero card → "Last game" strip → "Up next" inside `NextGamePanel` → season feed (`InsightStack`) → **Buzz** module | top insight overall; 3 postgame; 3 pregame; 12 season; top 3 articles + top 2 social → `/news` |
| **Live** (`/live`) | Pre-tip (`IdleState`): pregame cards. In game: live feed newest-first (as today) + **watch list** chip row | watch-list chips e.g. "Kawhi: 7 from a season high" |
| **Game page** (`/history/[id]`) | "Game story": postgame insights + **game-flow chart** (margin over time from `game_flow.margin_series`, runs highlighted) | up to 8 postgame insights |
| **Player page** (`/players/[id]`) | New "Insights" panel | up to 6 player-surface insights incl. milestone progress |
| **News** (`/news`, new nav item + ⌘K entry) | Articles + Social columns (desktop), stacked with All / Articles / Social filter (mobile) | see §3.3 |

### 3.2 Insight card

- **Sizes:** `hero` (visual large), `standard`, `compact` (list row, no visual). Replaces current `InsightCard` / `InsightStack` internals; same design tokens (`panel`, `pacific`, mono eyebrows).
- **Anatomy:** eyebrow (category · subject, 24px headshot via `nba_player_id` or team logo) → headline → context line (`text-mute`) → evidence visual → footer: `✓ Verified` · sample · **Receipts ▾**.
- **Evidence visuals:** `components/insights/evidence/{StreakStrip,RankTrack,HistoryLadder,Delta,MilestoneProgress,MarginSpark}.tsx`, inline SVG (no Recharts), each with `role="img"` and the `aria` summary.
- **Receipts drawer:** a `<button aria-expanded>` toggling a compact table of the proof rows with human column labels (label map per fact kind), the `updated_at` time and the records range ("Records since 1996-97"). Live cards show the play-by-play events.
- **Links:** the card links to its game (postgame/live) or player (season/player facts); nested interactive elements (receipts button) stop propagation.
- **Game-flow chart:** `components/game/GameFlowChart.tsx`, inline SVG area chart of the margin, above/below zero coloured `pos`/`neg`, largest runs shaded.

### 3.3 News page

- **Articles:** source logo, headline, relative time, thumbnail; opens in a new tab (`rel="noopener"`).
- **Social:** tweets rendered via X's embed widget (`platform.twitter.com/widgets.js`, lazy-loaded with `IntersectionObserver`; falls back to a text card with the Reddit title and link if the embed fails). Reddit posts show score and comment count. Bluesky posts rendered natively (author, text, counts, link).
- **Ranking:** articles by `published_at`; social by `engagement / (hours_since + 2)^1.5` (HN-style decay).
- **Labelled "From around the web"**; no Verified badge anywhere on the page or the Buzz module.

### 3.4 APIs and loaders

- `GET /api/insights?surface=&game_id=&player_id=&limit=`: `surface` added (`scope` still accepted); response adds `frame`, `evidence`, `entities`, `updated_at`.
- `GET /api/media?kind=article|social&limit=`.
- `src/lib/data/home.ts` returns composed `hero`, `last_game`, `up_next`, `season`, `buzz`; `history-game.ts` returns `game_story` + `game_flow`; the player loader returns `insights`.
- `app/api/live/route.ts` stops calling `generateLiveInsights`; it reads `insights WHERE surface='live' AND game_id=…` plus the watch list. `src/lib/insights/live.ts` is deleted once the runner path ships.

---

## 4. Live insights

- **Where:** `scripts/game-night.ts` via `scripts/lib/live-cycle.ts`. Each 12 s poll fetches box score + play-by-play (incremental by `event_num`), appends to `pbp_events`, and runs the live detectors.
- **Preload at tip** (one set of queries, held in memory for the game): each rostered player's career game log (pts/reb/ast/fg3m/stl/blk), season and career highs, active streaks, milestone targets; Clippers team/period highs from `rb_game_highs`; both teams' season averages (FG%, 3P%, pts per quarter). Per-poll framing then needs **no DB reads**.
- **Detectors:**
  - Scoring runs (≥ 8 unanswered, or 12–2 style ≥ 10-point differential over ≤ 3:00), framed against season/records.
  - Period and half bests: player/team points in a quarter or half vs season/records highs.
  - Pace, from halftime on: "on pace for 44" only when the pace projection would set a season or career high.
  - Watch list (not feed items): within 10% of a season/career high, within one game's reach of a milestone.
  - Milestones crossed in-game ("passes 15,000 career points").
  - Comeback in progress: trailing by ≥ 15 and now within 5.
  - Shooting vs norm: team 3P% in a half ≥ 15 points above season average on ≥ 12 attempts.
  - Clutch: margin ≤ 5 in the last 5:00, with the player's clutch line when notable.
- **Stability:** a fact must hold on 2 consecutive polls before it is written. Each fact has a dedup key per game (e.g. `live:half_pts:{player}:{game}:H1`); updates overwrite (a run growing from 10–0 to 14–0 updates one row).
- **Rate limit:** after the 3rd live insight in any rolling 3 minutes, the minimum importance to write rises by 10 per extra item.
- **Proof:** `proof_sql` selects the supporting `pbp_events` rows (by `game_id` and `event_num` range) joined with the record-book row the frame used; `proof_result` is those rows. After the final, `verify-insights` re-runs live proofs for that game.
- **Degraded feed:** when the snapshot is stale (`is_stale`), live detectors pause (existing behaviour kept).

---

## 5. Pipeline, testing, quality bar

### 5.1 Scheduling

| When | What |
|---|---|
| Nightly (`post-game.yml`) | existing steps → `ingest-pbp` (last 3 days) → `build-record-book` → `generate-insights` (season, postgame last 3 days, pregame next game, player) → `verify-insights` |
| Final buzzer (game-night runner) | after `finalizeGame`: derive PBP tables for the game → `generate-insights --surface=postgame --game=<id>` |
| Game day, ~75 min before tip (runner start) | `generate-insights --surface=pregame` (fresh line) |
| Every 12 s during games | live detectors (§4) |
| Every 15 min (`sync-media.yml`, new) | `sync-media` |
| One-time, local | `backfill-history`, `backfill-pbp-history` |

`generate-insights` gains `--surface`, `--game`, `--as-of` flags. Deactivation of stale claims is scoped per surface (and per game for postgame/live) so a single-game run never deactivates other games' insights.

### 5.2 Tests

- **Unit (vitest):** frame selection and strength ordering; scorer maths incl. triviality filter and Bayesian shrinkage; composer diversity and merge rules; every template renders for fixture facts (no `undefined`/`NaN`, ≤ 90 chars, correct plural/tense); evidence spec shapes; PBP parser (cdn + stats fixtures) and derived-table calculations (runs, lead changes, clutch window); media parsers (saved RSS, Reddit, Bluesky responses) and dedup.
- **Integration:** extend `scripts/lib/pipeline.integration.test.ts` fixture league with play-by-play and a record book; assert concrete framed claims (a seeded 50-point game produces a `records_best` postgame insight; a seeded 3-game 20-point streak for a 28-PPG scorer produces nothing).
- **UI:** component tests for each evidence visual (renders, aria label) and the receipts drawer toggle.

### 5.3 Quality harness

- `npm run insights:replay -- --as-of=YYYY-MM-DD [--surface=]`: runs every detector with the date cutoff against real data and prints ranked feeds per surface with `score_parts`, without writing (`--write` to a scratch schema optional).
- `npm run live:replay -- --game=<id> [--speed=]`: streams stored play-by-play through the live detectors in 12 s ticks and prints the feed timeline. Five 2025-26 Clippers games are kept in `pbp_events` for this.
- **Golden file** `scripts/lib/insights/golden.test.ts` (~20 editorial expectations, run in CI against the fixture league, and locally against real data via `--real`). Examples:
  - As of the day after a player's season-high game, that game's postgame insight is the Home hero.
  - A 28-PPG scorer's "20+ in 3 straight" never appears.
  - No surface has more than 2 items about one player.
  - Former Clippers never appear on Home, player or pregame surfaces.
  - Every headline ≤ 90 chars; every insight has a non-empty proof and a frame.
  - A 15-point comeback win produces a `game_flow` postgame insight.
  - During a live replay, no fact appears and disappears within 30 s.

---

## 6. Build order

Each phase ships and deploys on its own (`vercel deploy --prod` after merge).

1. **Data** — verify sources (stats.nba.com local probe; Reddit/Bluesky from Actions); schema migration; `backfill-history` (pause at 2010-11 for a size check); PBP parser + derived tables + `backfill-pbp-history`; `build-record-book`.
2. **Engine core** — fact/frame/score/render/compose modules, `insights` migration, port the six generators to season detectors, `--as-of` + `insights:replay`, golden tests.
3. **New surfaces** — postgame, pregame, player detectors; runner hook for postgame-at-final and pregame-at-start.
4. **UI** — new card + six evidence visuals + receipts; Home/game/player placements; game-flow chart; API/loader changes.
5. **News & social** — `media_items`, `sync-media` + workflow, `/api/media`, `/news`, Buzz module. Independent of 2–4; can run in parallel.
6. **Live** — runner integration, preload, live detectors, watch list, live proofs, `live:replay` tuning; remove `src/lib/insights/live.ts`.

Target: phases 1–5 by the 2026-27 opener (~Oct 20); live within the first two weeks, tuned on replays of 2025-26 games.

## 7. Risks and fallbacks

| Risk | Fallback |
|---|---|
| stats.nba.com refuses Luke's IP | Records start at 2022-23; frames adapt via `records_start`; PBP limited to cdn seasons |
| Neon storage limit | Backfill stops at the size checkpoint; history starts at that season |
| cdn.nba.com PBP unavailable for some 2022+ games | Game has no `game_flow`; flow-based detectors skip it |
| Reddit/Bluesky access fails from Actions | Ship articles-only; flag it |
| X embed fails (deleted post, script blocked) | Text card with title + link |
| Engine v2 regresses feed quality vs today | Replay harness compares v1 vs v2 feeds on the same dates before the legacy rows are deactivated |

## 8. Out of scope

- Push notifications / alerts.
- LLM-written or LLM-polished copy.
- Paid data (X API, Sportradar, Second Spectrum), injury reports, lineups/on-off data.
- Raw play-by-play storage for past seasons; league-wide play-by-play.
- User accounts or per-user "seen" tracking (novelty is global).

## 9. Setup Luke needs to do

- Run `backfill-history` and `backfill-pbp-history` locally (long-running, resumable).
- Create a Reddit "script" app and add `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` as GitHub Actions secrets.
- Create a free Bluesky app password (Settings → App passwords) and add `BSKY_HANDLE` and `BSKY_APP_PASSWORD` as GitHub Actions secrets.
- Confirm the Neon plan's storage limit before the backfill passes 2010-11.
