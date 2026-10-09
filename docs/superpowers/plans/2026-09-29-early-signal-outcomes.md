# Early Signal Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each existing confirmed bullish signal a transparent one-hour checkpoint and four-hour follow-up outcome based on saved market snapshots.

**Architecture:** Add a pure path evaluator that computes threshold and outcome evidence from snapshots. The realtime worker evaluates due stages and stores each result once on the existing signal document; the existing read model and feed/chart display the pending and completed stages.

**Tech Stack:** TypeScript, MongoDB driver, Next.js server components, React client components, existing Socket.IO realtime worker.

**Spec:** `docs/superpowers/specs/2026-09-29-early-signal-outcomes-design.md`

## Global Constraints

- Evaluate only existing `bullish` signals; leave bullish signal generation, bearish, volume-spike, and other signal rules unchanged.
- Keep separate cumulative one-hour and four-hour outcomes; the four-hour result must not overwrite the one-hour result.
- Use a 1.5% minimum for assets with market cap ≥$10B and valid reported 24-hour volume ≥$1B; use a 5.0% minimum otherwise.
- Raise, never lower, the tier minimum using 1.5 times the preceding 60-minute high-low range as a percentage of signal price.
- Require ≥45 samples spanning ≥55 minutes for the one-hour stage and ≥180 samples spanning ≥220 minutes for the four-hour stage; neither stage may contain a gap longer than five minutes.
- Missing BTC data affects benchmark display only, not outcome classification.
- Store stage results on the existing signal record, preserving compatibility with records that lack outcomes.
- Keep labels retrospective and factual; do not imply prediction, causation, or trading advice.
- Do not add or run automated tests unless requested; use the approved typecheck/build and manual review steps.

## Review Focus

- An outlier/missing volume value or unknown market cap must choose the conservative 5% tier.
- Missing/stale/duplicated samples must not produce false Success or Failed labels.
- A sampling gap that prevents determining which boundary came first must produce Mixed.
- Missing BTC samples must leave the price outcome intact and show the benchmark as unavailable.
- A worker restart after writing one stage must preserve that stage and later write the other stage independently.

---

### Task 1: Define outcome types and pure evaluator

**Files:**
- Create: `src/lib/signals/outcomes.ts`
- Modify: `src/lib/intel-types.ts`

**Interfaces:**
- Produce `SignalOutcomeStatus = "pending" | "success" | "failed" | "mixed" | "not_evaluated"`.
- Produce `SignalOutcomeStage` containing status, target/tier percentages, volatility range, entry/end price, return, maximum favorable/adverse move, rolling volume change, BTC return, sample coverage, reason, and evaluation timestamp.
- Produce `SignalOutcome = { oneHour?: SignalOutcomeStage; fourHour?: SignalOutcomeStage }` and add optional `outcome?: SignalOutcome` to `SignalDoc`.
- Export `calculateOutcomeBoundary(input)` and `evaluateSignalOutcomeStage(input)` as pure functions with explicit inputs for asset tier data, signal price/time, horizon, asset snapshots, BTC snapshots, and evaluation time.

- [ ] Define JSON-safe stored outcome types and internal snapshot inputs, including explicit stale metadata.
- [ ] Implement the asset tier rule and volatility-adjusted symmetric boundary.
- [ ] Implement stage coverage checks, first-boundary path classification, excursions, endpoint return, provider-reported volume change, BTC return, and human-readable not-evaluated reasons.
- [ ] Review the code against the Review Focus cases and run `npm run typecheck`.

### Task 2: Persist snapshots and evaluate due stages idempotently

**Files:**
- Modify: `src/lib/intel-types.ts`
- Modify: `scripts/realtime-worker.ts`
- Modify: `src/lib/db.ts` only if an index change is proven necessary.

**Interfaces:**
- Consume `SignalOutcomeStage` and `evaluateSignalOutcomeStage` from Task 1.
- Add `batchStale?: boolean` to `MarketSnapshotDoc` and persist `batch.stale` with each snapshot so stale provider batches are excluded.
- Add a worker function `evaluateDueBullishOutcomes(now: Date): Promise<void>` that independently evaluates due one-hour and four-hour stages and writes only the missing stage path (`outcome.oneHour` or `outcome.fourHour`).

- [ ] Persist batch staleness on new market snapshots; treat legacy rows as usable only when provider timestamp is within five minutes of `ingestedAt`.
- [ ] Query due `bullish` records using the existing signal indexes and evaluate one-hour results when age is ≥60 minutes and four-hour results when age is ≥240 minutes.
- [ ] Load pre-signal range samples, stage-window samples, and BTC samples where available; pass the stage-specific coverage and evidence to the pure evaluator.
- [ ] Write each stage with a conditional update that requires that stage to be absent, so restarts/retries cannot overwrite completed results.
- [ ] Call evaluation after the latest snapshot batch has been persisted; log failures and allow a later tick to retry.
- [ ] Run `npm run typecheck` and inspect the worker diff for query scope and idempotency.

### Task 3: Expose outcome stages in the Signals feed and coin chart

**Files:**
- Modify: `src/lib/data/intel-queries.ts`
- Modify: `src/components/SignalFeed.tsx`
- Modify: `src/components/intel/PriceHistoryChart.tsx`
- Modify: `src/app/(site)/market/[symbol]/page.tsx` if the initial chart payload needs the new outcome type.

**Interfaces:**
- Extend `SignalView` with optional `outcome?: SignalOutcome`.
- Consume stage results without recomputing the path or outcome in React.
- Keep existing signal records without `outcome` renderable; derive Pending for an uncomputed stage from signal age and stage horizon.

- [ ] Return the optional stored stage outcomes through `listSignals`.
- [ ] Show separate one-hour and four-hour cards/statuses for confirmed bullish signals, including the applied threshold, return, favorable/adverse moves, volume change, BTC context, coverage, and explanation.
- [ ] Render stage status in the existing bullish signal marker label/tooltip while retaining its original timestamp; distinguish pending, positive, negative, mixed, and unavailable states accessibly.
- [ ] Keep all copy factual and preserve the existing presentation of other signal types.
- [ ] Run `npm run typecheck` and manually review the Signals feed and coin chart at desktop and mobile widths.

### Task 4: Verify end-to-end behavior and compatibility

**Files:**
- Review: `src/lib/signals/outcomes.ts`
- Review: `scripts/realtime-worker.ts`
- Review: `src/components/SignalFeed.tsx`
- Review: `src/components/intel/PriceHistoryChart.tsx`

- [ ] Run `npm run typecheck` and `npm run build`.
- [ ] Manually inspect one-hour and four-hour Pending, Success, Failed, Mixed, and Not evaluated displays using representative signal/outcome records.
- [ ] Confirm missing BTC benchmark data and old signal documents without outcomes do not break either surface.
- [ ] Review generated user-facing explanations to ensure labels state the measured path and do not imply causation or advice.

## Completion notes

- The previously uncommitted early-watch implementation was discarded at the user's direction. Build on the committed signal classifier and attach outcomes only to existing `bullish` records.
- Do not push or merge unless requested.
