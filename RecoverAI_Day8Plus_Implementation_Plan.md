# RecoverAI — Post-Day-7 Implementation Plan
Based on a live audit of `github.com/guptarajat-stack/Recover-AI` (commit at time of audit: default branch, shallow clone).

---

## 1. Existing Implementation Audit

**Important deviation up front:** the actual repo is **not** what the plan doc describes. The plan says Python/FastAPI + Supabase/Postgres + pgvector + razorpay-mcp-server + Next.js. What's actually built is:

- **Node.js / Express** (not Python/FastAPI)
- **SQLite** via `sqlite3` (not Supabase/Postgres — this part of the plan is accurate as a *target*, just not yet started)
- **No `razorpay-mcp-server`** — the folder exists but is **empty**. Execution calls the `razorpay` npm SDK directly, not through MCP.
- **No LLM anywhere in the code.** The classifier is 100% rule-based (`if/else` on `error_code` + string-matching on `error_description`). Docs call it "rule-based + LLM-assisted" but no LLM call exists.
- **No frontend at all.** Zero `frontend/`, `web/`, `.jsx`, `.tsx`, or Next.js scaffolding.
- **No automated tests.** `package.json`'s `test` script is the default placeholder (`exit 1`). The only "test" artifact is the synthetic data generator, which isn't a test.
- **No `.env.example`**, no CI config.

This matters: your Day 8+ plan needs to route through **Node/Express/SQLite → Supabase/Postgres**, not assume a Python backend. I'm building the roadmap around the real stack.

### Component-by-component

| # | Component | What exists | Classification |
|---|---|---|---|
| 1 | **Architecture** | 5-stage pipeline (`docs/architecture.md`), matches Detect→Diagnose→Decide→Execute→Measure. Mermaid diagram present but describes Flask/FastAPI (stale vs actual Express code). | 🔧 Modify (fix diagram to match reality, evolve for Supabase/event-driven) |
| 2 | **Backend structure** | Single-process Node scripts (`server.js`, `classifier.js`, `policy_engine.js`, `executor.js`, `seed_db.js`, `generate_test_data.js`). No batching orchestrator — each stage is triggered by running the file directly (`node src/classifier.js`), not by an event trigger or scheduler. Pure polling-via-manual-invocation. | 🔧 Modify — keep the module boundaries, replace the "run script manually" trigger model with event-driven |
| 3 | **API endpoints** | Exactly one: `POST /webhook`. Handles `payment.failed`, `subscription.halted`, `order.created`, `invoice.overdue`. No `GET` endpoints for cases/metrics — nothing for a frontend to query yet. | ➕ Extend (needs read endpoints or direct Supabase client queries from frontend) |
| 4 | **Database/schema** | SQLite, 2 tables: `events` (raw ingestion incl. `processed` flag) and `recovery_cases` (bucket, intervention, status, attempts, revenue_at_risk/recovered, `audit_trail` as a JSON **text blob**, not structured). FK from cases→events. No `actions` table (execution results are appended into the same `audit_trail` JSON blob on `recovery_cases`, not a separate row-per-action table). No `contact_consent`, `manual_review_queue`, `batch_budget`, `batch_runs` — none of these exist yet. | 🔧 Modify + ➕ Extend heavily — this is the single biggest gap area |
| 5 | **Razorpay integration** | Real `razorpay` npm SDK, used in `executor.js` to call `razorpay.paymentLink.create(...)` for two intervention types. Test-mode keys via `.env`. Subscription retry and invoice reminder actions are **currently just simulated/logged**, not real API calls (`notify_and_recreate_mandate` and `promise_to_pay_tracker` just write a log string, no Razorpay call). | 🔧 Modify (wire the remaining 2 intervention types to real API calls) + ✅ Keep (payment link creation is solid, real, test-mode-safe) |
| 6 | **MCP integration** | Folder present, empty. No MCP server code, no MCP client wiring in `executor.js`. | ❌ Not implemented — decide whether to build it or drop it from the story (see note below) |
| 7 | **Classifier** | Rule-based only, 4 hardcoded categories mapped from `event_type` + string-matching on error descriptions. No confidence calibration beyond hardcoded numbers (e.g. always `0.95` for insufficient funds). No use of payment history, amount, time-of-day, or embeddings. Runs as a batch pass over `processed = 0` rows, not per-event. | 🔧 Modify — logic is sound as a **fallback tier**, but needs the pgvector layer on top |
| 8 | **Policy engine** | Reads `config/stopping_rules.json`. Implements max_attempts, cool-off hours, DND window check (simplified — uses server local time, not actual customer timezone). Discount cap (`max_discount_percentage: 10`) is defined in config but **not read or enforced anywhere in code** — `executor.js` hardcodes `* 0.9` independently. No budget/spend tracking across a batch. No consent check at all. | 🔧 Modify (wire config's discount cap into executor instead of hardcoding) + ➕ Extend (budget, consent hooks) |
| 9 | **Execution layer** | Real payment-link creation works end-to-end and test-mode-safe (dummy customer info, sandboxed notify flags). Mandate/invoice actions are simulated only. No retry/backoff, no idempotency key on Razorpay calls (risk: re-running executor on same case could create duplicate payment links). | 🔧 Modify (idempotency, wire remaining actions to real APIs) |
| 10 | **Test-data generator** | Solid — generates 75 synthetic events across all 4 event types with randomized amounts/timestamps, writes to `data/mock_events.json`, and `seed_db.js` loads it in. Good repeatable batch foundation for baseline comparison later. | ✅ Keep, ➕ Extend (needs seeded labeled cases for pgvector bootstrap, and a "known outcome" ground truth per event for the naive-baseline experiment to be meaningful) |
| 11 | **Tests** | None. | ❌ Missing entirely — needs to be built from scratch |
| 12 | **Frontend** | None. | ❌ Missing entirely — needs to be built from scratch |
| 13 | **Env/config** | `.env` referenced (not committed, correctly), `stopping_rules.json` is clean and easy to extend. No `.env.example` for onboarding. | 🔧 Modify (add `.env.example`) |
| 14 | **Technical debt** | (a) Audit trail is an unstructured JSON blob glued onto `recovery_cases`, not a queryable table — this blocks hash-chaining per spec 3.4 as written. (b) Pipeline stages are triggered by manually running scripts, no orchestration. (c) No idempotency on Razorpay calls. (d) DND check uses server local time not customer timezone. (e) Policy engine's `wait` action re-queues the case as `pending_policy_evaluation` with no scheduled re-check mechanism — it'll just get re-evaluated next time the script runs, which is fine for a demo but worth stating explicitly. | — |
| 15 | **Missing pieces for Day 8+** | Supabase/Postgres migration, actions table, contact_consent, manual_review_queue, batch_budget, hash-chain, pgvector, naive-baseline simulator, event-driven trigger, Realtime, entire frontend, all tests. | — |

---

## 2. What We Should NOT Touch

- **`generate_test_data.js` / `seed_db.js` event-shape logic** — the mock payload structures correctly mirror real Razorpay webhook shapes. Keep this; only add labeled-outcome fields on top for the classifier/baseline work.
- **`stopping_rules.json` structure** — clean, already has the right per-bucket fields (`max_attempts`, `cool_off_hours`, `dnd_compliance_required`, `max_discount_percentage`). Extend it (add budget fields) rather than redesigning it.
- **The `evaluatePolicy()` decision logic itself** (max attempts → cool-off → DND → action) — the sequencing is correct and matches the spec's intent. Wrap it with new gates (consent, budget), don't rewrite it.
- **Payment-link creation call in `executor.js`** — real, test-mode-safe, already working. Don't replace it; add idempotency and reuse the pattern for the other two action types.
- **The 5-stage naming/pipeline concept** (`Detect → Diagnose → Decide → Execute → Measure/Audit`) — keep this as the narrative spine for docs, README, and the demo script.

## 3. Gaps Remaining After Day 7

Rank-ordered by how much they block a convincing demo:

1. No database that can support Realtime/RLS/pgvector (SQLite ceiling)
2. No naive-baseline comparison — the single most judge-visible metric doesn't exist yet
3. No consent gate / manual review queue — "compliant" claim currently has zero backing
4. No budget cap enforcement — "bounded" claim currently has zero backing
5. No tamper-evident audit trail — "audit trail" claim currently has zero backing beyond an unstructured log blob
6. No event-driven trigger — pipeline only advances when someone manually runs each script
7. No frontend — nothing to actually show a judge except terminal output
8. No tests — reliability risk during a live demo
9. Classifier has no learned/similarity component, so "AI" is currently just `if/else` — a sharp judge will ask about this

---

## 4. Target Architecture

```
Razorpay Test APIs / Webhooks + Synthetic Generator
        ↓
Node/Express Webhook Listener  (sync, thin — validate + insert only)
        ↓
Supabase Postgres: events (JSONB raw_payload, pgvector embedding)
        ↓  (Postgres trigger, AFTER INSERT)
Supabase Edge Function (Deno/TS)              [async]
        ↓  calls out to Node backend HTTP endpoints (keep classifier/policy/
        ↓  executor logic in Node — don't reimplement business logic in Deno)
Root-Cause Classifier (pgvector NN → rule-based fallback)
        ↓
Policy Engine (stopping rules + consent gate + budget gate)
        ↓
Execution Layer (Razorpay test-mode SDK calls, idempotent)
        ↓
recovery_outcomes + actions (hash-chained)
        ↓
Next.js Dashboard  ← Supabase Realtime subscription (no polling)
        ↓
Metrics: naive-baseline vs RecoverAI, budget gauge, compliance feed, audit drill-down
```

**Sync vs async:**
- **Synchronous (Express):** webhook validation and insert into `events`. Nothing else — keep this endpoint fast and dumb.
- **Asynchronous (Edge Function, triggered by Postgres `AFTER INSERT` trigger):** everything from classification onward. This replaces "run the script manually" with real event-driven behavior, satisfying spec 3.2 without you having to port all business logic into Deno — the Edge Function's job is just to call your existing Node service's internal endpoints (e.g. `POST /internal/process-event`), keeping the classifier/policy/executor code where it already lives.
- **FastAPI:** not used — you're Node-based, so "what belongs in FastAPI" in the original plan maps to "what belongs in your existing Express app," specifically: webhook ingestion, and new internal endpoints (`/internal/process-event`, `/api/verify-audit-chain`, `/api/run-baseline`) that the Edge Function and frontend call.
- **PostgreSQL:** all state, RLS, the hash-chain trigger, the `AFTER INSERT` event trigger, ENUM types, pgvector column and index.
- **Next.js:** all four dashboard pages, Supabase Realtime subscriptions, no polling, no auth (per spec, intentionally skipped for demo speed).
- **pgvector:** on `events.embedding` for nearest-neighbor classification against labeled historical cases.
- **Realtime:** on `cases`/`recovery_cases` and `actions` tables, driving the Live Monitor, Budget gauge, and Compliance feed.
- **Audit trail:** generated at the Postgres layer via an `AFTER INSERT` trigger on `actions` that computes `this_hash = SHA256(row content || prev_hash)`, not application-layer, so it can't be bypassed by any single backend code path.

**On MCP:** the plan's original story leans on `razorpay-mcp-server`, but it was never actually vendored/wired, and the current executor already calls the real Razorpay SDK directly and works. Recommendation: **don't retrofit MCP in for Day 8+.** It adds surface area with no judge-visible payoff (a judge sees "real Razorpay test-mode API calls," not "calls routed through MCP specifically"). If asked in Q&A, be honest: direct SDK calls were used for reliability; MCP remains a natural next step for giving an LLM agent safe, scoped tool access. This is a good "what I'd do with more time" answer rather than a gap to hide.

---

## 5. Priority Matrix

**P0 — Must have (demo breaks without these)**
- Supabase/Postgres migration (events, cases, actions, contact_consent, manual_review_queue, batch_budget)
- Naive-baseline simulator + comparison metric
- Consent gate (blocks + escalates)
- Budget cap (blocks + gauge)
- Hash-chain audit trail + verify function
- Event-driven trigger (Postgres trigger → Edge Function)
- Frontend Pages 1, 2, 4 (Live Monitor, Metrics, Audit Drill-down)
- `seed_demo_batch` reproducible script

**P1 — High impact**
- pgvector similarity classifier with rule-based fallback
- Plain-English per-case explanation generator
- Frontend Page 3 (Bounds & Compliance)
- Idempotency on Razorpay calls
- Core unit tests (policy engine, consent gate, budget gate, hash verification, baseline simulator)

**P2 — Polish**
- Recovery-decay analytics (probability vs time-since-failure by bucket)
- Visual consistency pass across dashboard pages
- Deployed live URL (Vercel)
- `.env.example`, README overhaul, correlation IDs / structured logging

**P3 — Stretch**
- Epsilon-greedy/Thompson-sampling bandit for intervention selection
- Wiring `razorpay-mcp-server` for real (only if everything above is rock solid with days to spare)

---

## 6. Detailed Day 8+ Implementation Plan

### Phase 1 — Stabilize current Days 1–7 (½ day)
**Goal:** Fix the two correctness gaps before building on top of this code.
**Why it matters to judges:** nothing — but skipping this creates bugs that surface later during the demo.
**Files:** `src/executor.js`, `src/policy_engine.js`
**Steps:**
1. In `executor.js`, add an idempotency check: before creating a payment link, verify no prior successful action exists for this `case_id` (query the future `actions` table once it exists in Phase 2; for now, guard on `recovery_cases.status !== 'action_taken'`).
2. Wire `stopping_rules.json`'s `max_discount_percentage` into `executor.js` instead of the hardcoded `* 0.9`.
3. Wire the two simulated actions (`notify_and_recreate_mandate`, `promise_to_pay_tracker`) to real Razorpay test-mode calls where a real endpoint exists (e.g. invoice reminder via Razorpay Invoices API); keep mandate recreation simulated if Razorpay test mode doesn't cleanly support it, but log clearly that it's simulated so the demo narrative doesn't overclaim.
**Tests:** manual re-run of `seed_db.js` → `classifier.js` → `policy_engine.js` → `executor.js`, confirm no duplicate payment links on a second run.
**DoD:** running the pipeline twice on the same batch doesn't double-execute actions.
**Demo value:** low directly, high indirectly (prevents an embarrassing duplicate-charge moment live).
**Risk:** low. **Effort:** 2–3 hrs.

### Phase 2 — Supabase/Postgres migration (1–1.5 days)
**Goal:** Replace SQLite with Supabase Postgres; establish schema for everything downstream.
**Why it matters to judges:** "production-credible data layer" is explicitly on the panel checklist.
**Dependencies:** Phase 1.
**Files:** new `src/db.js` (Supabase client replacing sqlite3), migration SQL files, `.env.example`.
**DB migrations:**
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

CREATE TYPE root_cause_bucket AS ENUM
  ('insufficient_funds','bank_decline','expired_card','abandoned_checkout',
   'mandate_failure','overdue_invoice','unknown');
CREATE TYPE intervention_type AS ENUM
  ('wait_and_retry','send_payment_link_with_alt_method','send_discounted_payment_link',
   'notify_and_recreate_mandate','promise_to_pay_tracker','manual_review','stop');
CREATE TYPE case_status AS ENUM
  ('detected','diagnosed','decided','executed','recovered',
   'failed_to_recover','requires_manual_review');

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  razorpay_event_id TEXT,
  event_type TEXT NOT NULL,
  entity_id TEXT,
  amount INTEGER,
  currency TEXT DEFAULT 'INR',
  customer_id TEXT,
  customer_contact TEXT,
  error_code TEXT,
  error_description TEXT,
  raw_payload JSONB NOT NULL,
  embedding vector(1536),
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE recovery_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id),
  root_cause_bucket root_cause_bucket,
  classification_confidence NUMERIC,
  classification_evidence JSONB,
  intervention_type intervention_type,
  status case_status DEFAULT 'detected',
  attempts INTEGER DEFAULT 0,
  revenue_at_risk INTEGER,
  revenue_recovered INTEGER DEFAULT 0,
  explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES recovery_cases(id),
  action_type TEXT,
  success BOOLEAN,
  detail TEXT,
  prev_hash TEXT,
  this_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE contact_consent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT,
  channel TEXT,
  opt_in_at TIMESTAMPTZ,
  opt_out_at TIMESTAMPTZ,
  jurisdiction TEXT
);

CREATE TABLE manual_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES recovery_cases(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE batch_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID,
  max_total_discount INTEGER,
  max_contacts_per_hour INTEGER,
  spent_so_far INTEGER DEFAULT 0,
  contacts_sent_this_hour INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE batch_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT, -- 'naive_baseline' | 'recoverai'
  total_at_risk INTEGER,
  total_recovered INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
-- service_role: full access; anon: read-only on cases/actions for dashboard
```
**Steps:** stand up Supabase project → run migrations → rewrite `db.js` as a thin Supabase client wrapper → update `server.js`, `classifier.js`, `policy_engine.js`, `executor.js` to use it (same function shapes, different backend) → delete `sqlite3` dependency and `.sqlite` file → write one RLS-denial test (anon key attempting a write should fail).
**Tests:** RLS-denial test; round-trip insert/read for each table.
**DoD:** app reads/writes entirely through Supabase; RLS denial test passes; no SQLite references remain.
**Demo value:** foundational, not directly visible, but everything else depends on it.
**Risk:** medium (migration bugs). **Effort:** 1–1.5 days.

### Phase 3 — Event-driven core (½–1 day)
**Goal:** Postgres trigger + Edge Function replaces "run the script manually."
**Dependencies:** Phase 2.
**Files:** new `supabase/functions/process-event/index.ts`, new Postgres trigger, new internal Express endpoint `POST /internal/process-event`.
**Steps:** write `AFTER INSERT` trigger on `events` → Edge Function calls `POST {NODE_BACKEND_URL}/internal/process-event` with the new event id → that endpoint runs classify→policy→execute for that single event (refactor existing batch functions to also support single-event mode) → confirm dashboard-less test: insert one row via SQL, watch `recovery_cases` populate automatically.
**Tests:** insert-and-observe integration test (script that inserts an event, polls `recovery_cases` for the resulting row, asserts within N seconds).
**DoD:** a single `INSERT` into `events` results in a fully processed case with zero manual script runs.
**Demo value:** high — this is what makes "watch the pipeline happen live" possible in Scene 2 of the demo.
**Risk:** medium (Edge Function ↔ Node backend network reachability — if backend isn't publicly reachable, tunnel it or port the light logic into the Edge Function itself as a fallback). **Effort:** ½–1 day.

### Phase 4 — Consent + budget + audit (1–1.5 days) — highest-priority differentiator
**Goal:** Make "compliant," "bounded," and "auditable" real, provable claims.
**Dependencies:** Phase 2.
**Files:** `src/policy_engine.js` (add gates), new `src/consent_gate.js`, new `src/budget_gate.js`, new `src/audit_chain.js`.
**Steps:**
1. Consent gate: before any `executor.js` send, query `contact_consent`; no valid opt-in → insert into `manual_review_queue`, log a `compliant_escalation` action row, set case status `requires_manual_review`, do not call Razorpay.
2. Budget gate: before a costed action, check `batch_budget.spent_so_far` / `contacts_sent_this_hour` against caps; over cap → block, log `budget_cap_reached` action, don't execute.
3. Hash chain: Postgres trigger on `actions` `BEFORE INSERT` computes `this_hash = SHA256(row_json || COALESCE(prev_row.this_hash,''))`; `prev_hash` set from the latest existing row.
4. `verify_audit_chain()`: walks `actions` ordered by `created_at`, recomputes hashes, returns first mismatched row or "chain verified."
5. Seed one deliberately-corrupted row for demo purposes (a separate seed script, not the main path).
**Tests:** unit tests for consent gate (blocks correctly / allows correctly), budget gate (blocks at cap), hash verification (detects tampering on a corrupted fixture).
**DoD:** one seeded case is provably blocked for missing consent and shows in `manual_review_queue`; budget gauge data blocks a real action once over cap; `verify_audit_chain()` correctly flags a corrupted row.
**Demo value:** very high — Scenes 6, 7, 10 of the demo depend entirely on this phase.
**Risk:** low-medium. **Effort:** 1–1.5 days.

### Phase 5 — pgvector classifier + naive baseline (1 day)
**Goal:** Real similarity-based classification with fallback; and the single most important judging number.
**Dependencies:** Phase 2.
**Files:** `src/classifier.js` (add embedding + NN path), new `src/embeddings.js`, new `src/baseline_simulator.js`.
**Steps:**
1. Build feature text per event (error code + description + payment method + amount bucket + time-of-day + customer's past failure count).
2. Generate embedding, store in `events.embedding`.
3. Hand-label ~15–20 seed cases across buckets to bootstrap NN search.
4. Classify via `embedding <-> nearest_neighbor`; if best-match distance is below a confidence threshold, fall back to the existing rule-based `classifyEvent()` — keep that function, don't delete it.
5. `baseline_simulator.js`: run "retry everything blindly" over the identical seeded batch (same `mock_events.json`), log recovered/at-risk into `batch_runs` with label `naive_baseline`.
6. Run RecoverAI's actual pipeline over the same batch, log into `batch_runs` with label `recoverai`.
7. Expose a simple diff query for the dashboard.
**Tests:** unit test for fallback logic (low-confidence NN triggers rule-based path); baseline simulator determinism test (same batch → same result on reseed).
**DoD:** classifier returns bucket + confidence + evidence + similar historical cases; `batch_runs` contains one real naive row and one real RecoverAI row from the same batch with an honest delta.
**Demo value:** very high — this is explicitly called out as one of the most important judging features.
**Risk:** medium (embedding API cost/latency, NN threshold tuning). **Effort:** 1 day.

### Phase 6 — Analytics + explainability (½–1 day)
**Goal:** Show *why* and *when*, not just *what*.
**Dependencies:** Phase 2, 5.
**Files:** new `src/explain.js`, new analytics query module.
**Steps:** per-case plain-English generator built from actual structured fields (bucket, confidence, action, outcome, time-to-recovery) — template-based is fine and safer than freeform LLM text for demo reliability; recovery-decay query grouping by `(root_cause_bucket, hours_since_failure_bucket)`.
**Tests:** explanation generator produces non-empty, field-consistent text for every case status.
**DoD:** every case has a stored explanation string; decay data queryable and chartable.
**Demo value:** medium-high (Scene 9).
**Risk:** low. **Effort:** ½–1 day.

### Phase 7 — Frontend (2–2.5 days)
**Goal:** Make everything above visible.
**Dependencies:** Phases 2–6 (can start scaffolding earlier in parallel).
**Files:** new `frontend/` Next.js + Tailwind + Supabase-JS app, 4 pages.
**Steps:** scaffold → Page 1 Live Monitor (Realtime subscription on `recovery_cases`/`actions`) → Page 2 Metrics (headline naive-vs-RecoverAI delta) → Page 3 Bounds & Compliance (budget gauge via Realtime on `batch_budget`, escalation feed) → Page 4 Audit drill-down (raw JSONB, explanation, Verify Chain Integrity button calling a new `GET /api/verify-audit-chain` endpoint) → visual consistency pass.
**Tests:** manual — insert test row, confirm live update with zero refresh on each relevant page.
**DoD:** all 4 pages functional, realtime, visually consistent, deployed to a live URL.
**Demo value:** very high — this is what the judges actually watch.
**Risk:** medium (time-boxed; this is the largest single phase). **Effort:** 2–2.5 days.

### Phase 8 — Integration testing (½–1 day)
Run 2–3 full batch simulations end to end, fix race conditions/RLS denials/dropped subscriptions, deploy backend + frontend so there's a URL independent of localhost.

### Phase 9 — Demo preparation (½ day)
Build `seed_demo_batch`, `run_baseline`, `run_recoverai`, `verify_audit_chain` as single commands. Rehearse the 10-scene script below.

### Phase 10 — Submission polish (½ day)
README rewrite (setup, architecture, how to run, Supabase steps, frontend deploy steps), architecture diagram update to reflect actual stack (Node/Express, not Flask/FastAPI), demo video, pitch deck.

---

## 7. Database Design

Covered fully in Phase 2 above. Summary of what's new vs Days 1–7: `raw_payload` JSONB, `embedding` vector column, ENUM types replacing free-text, a real `actions` table (currently actions are just log lines glued into `recovery_cases.audit_trail`), plus four entirely new tables (`contact_consent`, `manual_review_queue`, `batch_budget`, `batch_runs`).

## 8. API / Event Flow

- `POST /webhook` — existing, keep as-is (sync, thin).
- `POST /internal/process-event` — new, called by the Edge Function; runs classify→policy→execute for one event id.
- `GET /api/verify-audit-chain` — new, called by the frontend's "Verify Chain Integrity" button.
- `POST /api/run-baseline`, `POST /api/run-recoverai` — new, trigger the two simulation modes over a batch for demo reproducibility.
- Everything else (case lists, metrics, budget state) is read directly by the Next.js frontend via the Supabase JS client + Realtime subscriptions — no need for extra Express read endpoints.

## 9. AI/Classifier Strategy

Two-tier: pgvector nearest-neighbor as the primary path (genuinely learned/similarity-based, addresses judge question #3 directly), existing rule-based classifier as a transparent, explainable fallback when NN confidence is low. Never silently drop the rule-based path — its determinism is actually a feature during a live demo when the embedding API might be slow/unavailable.

## 10. Security & Compliance Strategy

RLS on every table from day one. Consent gate is a hard stop before any outbound send, not a soft warning. Budget gate is enforced at the gate function level, called from `executor.js` before any Razorpay API call — not just reflected in the UI. Hash-chain is computed via a Postgres trigger, not application code, so it can't be silently bypassed by a code path that forgets to call it.

## 11. Testing Strategy

**Unit:** classifier (rule fallback correctness), policy engine (attempts/cool-off/DND), consent gate, budget gate, hash verification (tamper detection), baseline simulator (determinism).
**Integration:** webhook→DB, DB trigger→Edge Function→classifier→policy→executor, Realtime→frontend.
**Security:** RLS denial, malformed webhook payload, duplicate event id, replayed event, invalid/missing consent, budget bypass attempt (calling executor directly while over cap).
**Demo tests:** `seed_demo_batch`, `run_baseline`, `run_recoverai`, `verify_audit_chain` as single reproducible commands.

## 12. Frontend/Dashboard Plan

Covered in Phase 7. Four pages: Live Monitor, Recovery Metrics (headline = naive-vs-RecoverAI delta), Bounds & Compliance (budget gauge + escalation feed), Case Audit Trail drill-down (raw JSON + explanation + Verify Chain Integrity). No auth. Consistent per-bucket accent color across all pages.

## 13. 5-Minute Judge Demo Script

1. **Generate batch** — run `seed_demo_batch` (20–50 events across insufficient funds, bank decline, expired mandate, OTP drop-off, price friction, one missing-consent case, one budget-cap case).
2. **Watch cases appear** in Live Monitor — zero refresh.
3. **Show AI diagnosis** — open a case, show bucket + confidence + evidence + similar historical cases.
4. **Show different policies** for different root causes side by side.
5. **Show real Razorpay test-mode actions** — open the generated payment link.
6. **Show one case blocked** for missing consent → routed to manual review.
7. **Show budget cap** stopping a new action live, gauge hits the line.
8. **Show RecoverAI vs blind retry** — headline delta number on Metrics page.
9. **Open a case, show explainability** — plain-English paragraph.
10. **Click Verify Chain Integrity** — pass on the clean chain, then show the deliberately corrupted seed row failing.

## 14. Judge Questions We Should Be Ready For

- "Is this actually AI or just if/else?" → pgvector NN classifier + fallback story (Phase 5), be honest about which parts are rule-based.
- "Why not use the MCP server you originally planned?" → direct SDK calls were more reliable for a hackathon timeline; MCP is a clear stated next step for giving an LLM agent scoped tool access.
- "How do you know the recovery numbers aren't cherry-picked?" → same seeded batch, both simulations, `batch_runs` table with timestamps, reproducible via `run_baseline`/`run_recoverai`.
- "What happens if the embedding API is down mid-demo?" → rule-based fallback kicks in automatically, demo doesn't break.
- "Is the audit trail really tamper-evident or just logged?" → live-corrupt-and-verify demonstration (Scene 10).

## 15. Failure Scenarios & Backup Plan

- **Embedding API slow/unavailable during demo:** rule-based fallback handles it silently; mention it if asked, don't dwell on it.
- **Realtime subscription drops:** have a manual refresh fallback button that still queries Supabase directly (cheap insurance, low effort).
- **Live Razorpay test API flakiness:** pre-seed one successful payment-link case as backup evidence alongside the live one.
- **Edge Function ↔ Node backend reachability issues:** have a manual "process event" button in the frontend that calls the same endpoint directly, as a fallback demo path if the trigger chain misbehaves.

## 16. Final Definition of "Submission Ready"

- All P0 items complete and passing their tests
- `seed_demo_batch` → full pipeline → dashboard reproducible in under 2 minutes on a clean environment
- Naive-vs-RecoverAI delta is real, not fabricated, and reproducible
- One consent-blocked case, one budget-capped case, and one corrupted audit row exist in the seeded demo data
- Live deployed frontend URL works independent of localhost
- README lets a stranger clone, set up Supabase, and run the demo end to end

## 17. Exact First Task To Implement

**Phase 1, step 1–2** (idempotency guard + wire the discount cap from config instead of the hardcoded value in `executor.js`), immediately followed by **Phase 2** (Supabase migration) — because literally everything else in this plan depends on having Postgres in place. Do not start on pgvector, consent, budget, or frontend work before the migration is done and the RLS-denial test passes.
