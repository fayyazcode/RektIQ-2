/**
 * News ↔ market correlation (Phase 9). Runs from the realtime worker or as a
 * one-off job. Reuses the existing pipeline's `coins` tags (set during RSS
 * normalization — no new NLP needed). For each tagged article with enough
 * post-publication history, stores the OBSERVED price/volume movement in a
 * window after publication. Wording is deliberately correlational: an impact
 * record never claims the article caused the move.
 */
import { collections, ensureIndexes, hasDatabase } from "../src/lib/db";
import type { AssetSnapshot } from "../src/lib/market/types";

export const IMPACT_WINDOW_MINUTES = 60;
export const IMPACT_FORMULA_VERSION = "news-impact-v1";

type SnapshotRow = AssetSnapshot & { ingestedAt: Date };

/** Interpolate the price at time `t` from chronological snapshots; null if outside range. */
export function priceAt(snaps: { timestamp: string; price: number }[], t: number): number | null {
  if (!snaps.length) return null;
  const times = snaps.map((s) => new Date(s.timestamp).getTime());
  if (t < times[0] || t > times[times.length - 1]) return null;
  for (let i = 1; i < snaps.length; i++) {
    if (times[i] >= t) {
      const t0 = times[i - 1];
      const t1 = times[i];
      if (t1 === t0) return snaps[i].price;
      const f = (t - t0) / (t1 - t0);
      return snaps[i - 1].price + f * (snaps[i].price - snaps[i - 1].price);
    }
  }
  return snaps[snaps.length - 1].price;
}

/** Mean volume per snapshot inside [from, to]; null when no samples. */
export function avgVolumeIn(snaps: { timestamp: string; volume24h: number }[], from: number, to: number): number | null {
  const inWindow = snaps.filter((s) => {
    const t = new Date(s.timestamp).getTime();
    return t >= from && t <= to;
  });
  if (!inWindow.length) return null;
  return inWindow.reduce((a, b) => a + b.volume24h, 0) / inWindow.length;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export async function runNewsCorrelation(now = new Date()) {
  if (!hasDatabase()) return { skipped: "no database" };
  await ensureIndexes().catch(() => {});
  const c = await collections();

  // Articles from the last 48 h that mention a tracked asset and have no impact row yet.
  const since = new Date(now.getTime() - 48 * 3600_000);
  const pending = await c.articles
    .find({ publishedAt: { $gte: since, $lte: new Date(now.getTime() - (IMPACT_WINDOW_MINUTES + 15) * 60_000) }, coins: { $exists: true, $ne: [] } })
    .sort({ publishedAt: -1 })
    .limit(200)
    .toArray();

  let computed = 0;
  let skippedNoData = 0;
  for (const art of pending) {
    for (const rawSymbol of art.coins ?? []) {
      const symbol = String(rawSymbol).toUpperCase();
      const exists = await c.newsImpacts.findOne({ articleId: art._id as any, symbol });
      if (exists) continue;

      const pubMs = art.publishedAt.getTime();
      const windowMs = IMPACT_WINDOW_MINUTES * 60_000;
      const snaps = (await c.marketSnapshots
        .find({ symbol, ingestedAt: { $gte: new Date(pubMs - 3 * windowMs), $lte: new Date(pubMs + 2 * windowMs) } } as any, { sort: { ingestedAt: 1 }, limit: 400 })
        .toArray()) as SnapshotRow[];
      if (snaps.length < 3) {
        skippedNoData++;
        continue; // no stored market history for this asset yet → no impact claim
      }
      const before = priceAt(snaps, pubMs - windowMs);
      const after = priceAt(snaps, Math.min(pubMs + windowMs, new Date(snaps[snaps.length - 1].timestamp).getTime()));
      if (before === null || after === null || before <= 0) {
        skippedNoData++;
        continue;
      }
      const volBefore = avgVolumeIn(snaps, pubMs - windowMs, pubMs);
      const volAfter = avgVolumeIn(snaps, pubMs, pubMs + windowMs);
      const changePct = round2(((after - before) / before) * 100);
      try {
        await c.newsImpacts.insertOne({
          articleId: art._id as any,
          symbol,
          headline: art.title.slice(0, 300),
          source: art.source,
          url: art.url,
          publishedAt: art.publishedAt,
          windowMinutes: IMPACT_WINDOW_MINUTES,
          priceBefore: round2(before * 1e6) / 1e6,
          priceAfter: round2(after * 1e6) / 1e6,
          priceChangePct: changePct,
          volumeBefore: volBefore ?? 0,
          volumeAfter: volAfter ?? 0,
          volumeReactionRatio: volBefore && volBefore > 0 && volAfter !== null ? round2(volAfter / volBefore) : null,
          computedAt: now,
          formulaVersion: IMPACT_FORMULA_VERSION,
        });
        computed++;
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err; // unique(articleId,symbol) → already done
      }
    }
  }

  // Entity relationships for every recent article (cheap upsert, powers per-symbol news feeds).
  const entityOps: Array<Parameters<typeof c.newsEntities.bulkWrite>[0][number]> = [];
  for (const art of pending) {
    for (const rawSymbol of art.coins ?? []) {
      entityOps.push({
        updateOne: {
          filter: { articleId: art._id, symbol: String(rawSymbol).toUpperCase() },
          update: {
            $setOnInsert: {
              articleId: art._id,
              storyId: art.storyId as any,
              symbol: String(rawSymbol).toUpperCase(),
              title: art.title,
              url: art.url,
              source: art.source,
              publishedAt: art.publishedAt,
              createdAt: now,
            },
          },
          upsert: true,
        },
      });
    }
  }
  if (entityOps.length) await c.newsEntities.bulkWrite(entityOps, { ordered: false }).catch(() => {});

  return { computed, skippedNoData, articles: pending.length };
}

if (process.argv[1] && process.argv[1].includes("news-correlation")) {
  runNewsCorrelation()
    .then((r) => console.log("[news-correlation]", r))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
