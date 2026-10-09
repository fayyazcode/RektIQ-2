/** Scheduled anomaly pass over recent persisted market snapshots. */
import "../scripts/_env";
import { closePostgresDb, getPostgresDb } from "../src/lib/db/client";
import type { AssetSnapshot } from "../src/lib/market/types";
import { computeBaseline, detectAnomalies, isNewAnomaly, parseStoredAssetSnapshot, ANOMALY_FORMULA_VERSION } from "../src/lib/anomalies/engine";
import * as schema from "../src/lib/db/schema";
import { and, eq, gte, desc, asc } from "drizzle-orm";

const BASELINE_WINDOW_HOURS = 24;
const COOLDOWN_MS = 2 * 3600_000;
const MAX_SNAPSHOT_AGE_MS = 3 * 3600_000;

async function runAnomalyPass() {
  try {
    const db = getPostgresDb();

    const recentSnapshots = await db
      .select()
      .from(schema.marketSnapshots)
      .where(and(
        gte(schema.marketSnapshots.ingestedAt, new Date(Date.now() - MAX_SNAPSHOT_AGE_MS)),
        eq(schema.marketSnapshots.batchStale, false),
      ))
      .orderBy(desc(schema.marketSnapshots.ingestedAt))
      .limit(2000);

    const latestBySymbol = new Map<string, AssetSnapshot>();
    for (const snapshot of recentSnapshots) {
      if (latestBySymbol.has(snapshot.symbol)) continue;
      const parsed = parseStoredAssetSnapshot(snapshot.symbol, snapshot.snapshot);
      if (parsed) latestBySymbol.set(snapshot.symbol, parsed);
    }
    if (latestBySymbol.size === 0) return { checked: 0, created: 0, failed: 0, message: "No recent snapshots to analyze." };

    const symbols = [...latestBySymbol.keys()];
    const newsRows = await db
      .select({ _id: schema.articles.id, coins: schema.articles.coins })
      .from(schema.articles)
      .where(
        and(
          gte(schema.articles.publishedAt, new Date(Date.now() - 24 * 3600_000)),
          // Check if any coins array element is in symbols
          // We'll do this in-memory since JSON array contains is complex in drizzle
        )
      );

    // Flatten and count coins per symbol (in-memory filtering)
    const newsCounts = new Map<string, number>();
    for (const row of newsRows) {
      const coins = Array.isArray(row.coins) ? row.coins : [];
      for (const coin of coins) {
        const upper = coin.toUpperCase();
        if (symbols.includes(upper)) {
          newsCounts.set(upper, (newsCounts.get(upper) ?? 0) + 1);
        }
      }
    }

    let created = 0;
    let failed = 0;
    for (const [symbol, snapshot] of latestBySymbol) {
      try {
        const history = await db
          .select({ snapshot: schema.marketSnapshots.snapshot })
          .from(schema.marketSnapshots)
          .where(
            and(
              eq(schema.marketSnapshots.symbol, symbol),
              gte(schema.marketSnapshots.ingestedAt, new Date(Date.now() - BASELINE_WINDOW_HOURS * 3600_000)),
              eq(schema.marketSnapshots.batchStale, false),
            )
          )
          .orderBy(asc(schema.marketSnapshots.ingestedAt))
          .limit(200);

        const parsedHistory = history.flatMap((row) => {
          const parsed = parseStoredAssetSnapshot(symbol, row.snapshot);
          return parsed ? [parsed] : [];
        });
        if (parsedHistory.length < 3) continue;

        const baseline = computeBaseline(parsedHistory, BASELINE_WINDOW_HOURS);
        const newsCount = newsCounts.get(symbol) ?? 0;
        baseline.newsRatePerHour = newsCount / 24;

        const recent = await db
          .select()
          .from(schema.anomalies)
          .where(
            and(
              eq(schema.anomalies.symbol, symbol),
              gte(schema.anomalies.occurredAt, new Date(Date.now() - COOLDOWN_MS))
            )
          )
          .orderBy(desc(schema.anomalies.occurredAt))
          .limit(100);

        const recentAnomalies = recent.map((item) => ({ type: item.type, timestamp: item.occurredAt.toISOString() }));

        for (const candidate of detectAnomalies(snapshot, baseline, newsCount)) {
          if (!isNewAnomaly(recentAnomalies, candidate, COOLDOWN_MS)) continue;
          const bucket = Math.floor(Date.now() / COOLDOWN_MS);
          try {
            await db
              .insert(schema.anomalies)
              .values({
                dedupeKey: `${symbol}:${candidate.type}:${bucket}`,
                symbol,
                type: candidate.type,
                severity: candidate.severity,
                observed: candidate.observed,
                baseline: candidate.baseline,
                ratio: candidate.ratio,
                description: candidate.description,
                occurredAt: new Date(candidate.timestamp),
                baselineWindowHours: candidate.baselineWindowHours,
                formulaVersion: ANOMALY_FORMULA_VERSION,
                createdAt: new Date(),
              })
              .onConflictDoNothing();
            created++;
            recentAnomalies.push({ type: candidate.type, timestamp: candidate.timestamp });
            console.log(`[anomalies] ${symbol} ${candidate.type} (${candidate.severity})`);
          } catch (err) {
            if ((err as { code?: number }).code !== 23505) throw err; // unique constraint violation - already processed
          }
        }
      } catch (err) {
        failed++;
        console.error(`[anomalies] ${symbol} failed:`, err instanceof Error ? err.message : err);
      }
    }

    return { checked: latestBySymbol.size, created, failed, message: "Anomaly pass finished from persisted snapshots." };
  } catch (err) {
    throw err;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("[anomalies] DATABASE_URL not set — skipping anomaly processing.");
    return;
  }
  await runAnomalyPass();
}

main()
  .catch((err) => {
    console.error("[anomalies] worker failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresDb();
  });