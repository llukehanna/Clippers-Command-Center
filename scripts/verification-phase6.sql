-- Phase 6 Insight Engine — Verification Queries
-- Run after: npm run generate-insights

-- 1. Total insight count
SELECT COUNT(*) AS total_insights FROM insights;

-- 2. Breakdown by category
SELECT category, scope, COUNT(*) AS insight_count
FROM insights
GROUP BY category, scope
ORDER BY category, scope;

-- 3. Zero fabricated insights — must return 0 rows
SELECT COUNT(*) AS fabricated_count
FROM insights
WHERE proof_result = '[]'::jsonb
   OR proof_result IS NULL
   OR proof_sql = ''
   OR proof_sql IS NULL;

-- 4. Idempotency check — run generate-insights twice; this should return same count both times
SELECT COUNT(*) AS total_after_rerun FROM insights;

-- 5. Sample top insights by importance
SELECT category, headline, importance, scope
FROM insights
ORDER BY importance DESC
LIMIT 10;

-- 6. proof_hash uniqueness — must return 0 (no duplicate hashes)
SELECT proof_hash, COUNT(*) AS count
FROM insights
GROUP BY proof_hash
HAVING COUNT(*) > 1;

-- 7. Verify proof_hash unique index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'insights' AND indexname = 'uq_insights_proof_hash';
