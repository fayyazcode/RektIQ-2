# Bullish Signal Outcomes and Calibration

## Goal

Show whether an existing confirmed bullish signal was followed by a meaningful favorable or adverse price move, with enough chart and market evidence for users to understand the label. Outcomes describe observed price behavior; they do not predict returns or establish that the signal caused the move.

## Scope

- Evaluate existing `bullish` signals only in the first version.
- Keep all existing signal-generation thresholds and rules unchanged.
- Evaluate each bullish signal at one hour and again at four hours after issuance.
- Show pending and final outcomes in the Signals feed and on the asset chart.
- Use saved market snapshots and existing market evidence; do not add social sources, market providers, or a separate outcome collection.
- Do not add a trading/backtest recommendation or aggregate performance claims in this version.

## Outcome thresholds

Use a symmetric upside and downside boundary so outcome labels are mechanically clear:

| Asset tier at signal time | Minimum boundary |
| --- | ---: |
| Large and liquid | 1.5% |
| Other / smaller / unknown | 5.0% |

For the initial configurable default, an asset is **large and liquid** when its market cap is at least $10 billion and its reported 24-hour volume is at least $1 billion. If volume is missing or flagged as an outlier, or either value is unknown, use the other/smaller tier.

To account for unusually volatile recent behavior, calculate `(highest price - lowest price) / signal price * 100` over the 60 minutes before the signal. Set the final boundary to the greater of the tier minimum and 1.5 times that preceding range. Save and display both the tier minimum and final applied boundary. The market-cap/volume cutoffs and volatility multiplier are proposed defaults and must remain named configuration constants so they can be adjusted after observing actual outcome coverage.

## Outcome rules

Capture the signal price at issue time and examine subsequent persisted snapshots for two cumulative windows: the first 60 minutes and the first 240 minutes. The one-hour and four-hour statuses are stored separately; the later result never overwrites the earlier checkpoint. Each stage stays Pending until its full window ends:

- **Success:** price reaches the positive boundary before reaching the negative boundary.
- **Failed:** price reaches the negative boundary before reaching the positive boundary.
- **Mixed:** neither boundary is reached by that stage's deadline, or a sampling gap makes the order of the first boundary crossing impossible to establish.
- **Not evaluated:** there is not enough valid snapshot coverage to determine the path.
- **Pending:** that stage's evaluation window has not finished.

Boundary crossing is evaluated from successive snapshot prices from the signal time through each stage's deadline. If a gap between observations spans both boundaries, their order cannot be established, so classify that stage as Mixed. For the one-hour stage, require at least 45 valid post-signal snapshots spanning at least 55 minutes, with no gap longer than five minutes. For the four-hour stage, require at least 180 valid post-signal snapshots spanning at least 220 minutes, with no gap longer than five minutes. If a stage's coverage requirement fails, save `not_evaluated` for that stage with a reason. For the volatility adjustment, use the 1.5%/5.0% tier minimum when the preceding hour lacks sufficient observations and record that the volatility adjustment was unavailable.

## Evidence shown to users

Each bullish signal detail shows both its one-hour checkpoint and four-hour follow-up, each with:

- Issue price and the one-hour and four-hour evaluation windows.
- Tier minimum, volatility adjustment, and final applied boundary.
- Stage-end observed price and percentage return from the signal price.
- Maximum favorable and adverse price movement through that stage's window.
- Change in provider-reported 24-hour volume over the window (labeled as a rolling 24-hour metric, not interval volume).
- BTC return over the same window when BTC snapshots are present; otherwise show that the benchmark is unavailable.
- Data coverage and any reason an outcome could not be evaluated.
- A plain-language explanation for each checkpoint, such as “price crossed the +5.0% boundary before the −5.0% boundary” or “the four-hour window ended without crossing either boundary.”

The chart keeps the bullish marker at its issue time and visually distinguishes its one-hour and four-hour results. Users can focus or hover the marker to see the score, timestamp, each stage's status, applied boundary, and observed return. The Signals feed shows both stages as Pending until their respective evaluations complete, then retains both terminal statuses and evidence.

Use “Failed” only as the defined downside-boundary outcome label. Do not describe it as proof that the signal was wrong in all respects or that any specific event caused the move. Keep the existing informational, not-investment-advice framing.

## Data flow and storage

1. The realtime worker continues persisting the current market snapshots (normally about once per minute).
2. When each stage reaches its deadline, the worker loads the signal-time snapshot, the preceding hour used for volatility, the relevant post-signal window, and BTC snapshots if available.
3. A pure outcome evaluator calculates the tier, boundary, coverage, stage path status, and explanatory metrics for the one-hour or four-hour checkpoint.
4. Store both stage results in an optional subdocument on the existing signal document. Each stage is written once and independently, so a retry or worker restart cannot replace completed evidence. Existing signal retention keeps both results available with the signal; no new collection or scheduled workflow is required.
5. The existing signals query exposes the optional outcome to the feed and asset chart. Older signal documents without an outcome remain valid.

## Failure and data-quality behavior

- A missing signal-time quote or insufficient post-signal coverage produces Not evaluated, with a human-readable reason.
- A missing pre-signal history falls back to the tier minimum and reports that the volatility adjustment could not be calculated.
- Missing BTC snapshots affect only benchmark context, never the Success/Failed classification.
- Stale or duplicated observations are excluded from range and coverage calculations.
- Outcome-evaluation database errors are logged; later worker ticks may retry while the affected stage has no outcome.
- Evaluation is idempotent so worker restarts cannot create conflicting outcomes.

## Implementation boundaries

- Extend the existing signal document/view model with an optional outcome object.
- Add a pure evaluator near the signal engine and a due-outcome pass in the realtime worker.
- Extend the existing signal detail/feed and `PriceHistoryChart` marker display.
- Keep `market_snapshots` as the source of post-signal and pre-signal prices, using its current 30-day TTL.
- No database migration is expected; optional fields preserve compatibility with existing documents.

## Acceptance criteria

1. A bullish signal has distinct one-hour and four-hour Pending states, and each receives a terminal outcome only after its full window is available.
2. Large/liquid and other assets receive the documented tier minimums; volatility can raise, but never lower, the applied boundary.
3. Success and Failed are assigned only when the respective boundary is observed first.
4. Simultaneous/in-order-ambiguous boundary crossings are Mixed, not guessed.
5. Insufficient snapshots produce Not evaluated for the affected stage and expose the reason without erasing the other stage's result.
6. The feed and chart show the applied boundary, status, and core evidence, and the details explain why the status was assigned.
7. Missing BTC data does not block outcome evaluation.
8. Existing bearish, volume-spike, and other signal behaviors remain unchanged; bullish signal generation is also unchanged.
9. Existing signals without outcome fields continue to render.
10. Outcome text remains factual and does not imply prediction, causation, or a recommended trade.

## Verification

- Verify outcome evaluator cases for both boundary orders, no-boundary mixed results, simultaneous crossings, volatility-adjusted thresholds, missing benchmark data, and insufficient coverage.
- Run the repository typecheck and production build.
- Inspect the Signals feed and an asset chart with Pending, Success, Failed, Mixed, and Not evaluated examples.
- Do not add or run automated tests unless requested.

## Risks and mitigations

- **Noisy provider snapshots:** use explicit coverage requirements and make ambiguous crossings Mixed.
- **Threshold tiers may fit poorly:** keep cutoffs named/configurable and expose the applied calculation to users.
- **High-volatility assets may rarely resolve in one hour:** retain Mixed as a valid result and show the measured range; reconsider a longer window only after reviewing observed coverage.
- **Misreading labels as trade advice:** explain the exact retrospective rule and show returns and limitations next to every outcome.
- **Signals expire from storage:** the existing seven-day TTL after signal expiry retains completed outcome details for a review window; no separate indefinite history is promised.
