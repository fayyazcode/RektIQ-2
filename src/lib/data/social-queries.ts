import "server-only";

import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { hasDatabase } from "../db";
import { hasSecret } from "../env";
import { getPostgresDb } from "../db/client";
import * as schema from "../db/schema";
import { aggregateSentiment, SENTIMENT_FORMULA_VERSION } from "../social/sentiment";
import { getXProvider } from "../social/x-provider";

const FRESH_X_MS = 2 * 3600_000;
const SIGNAL_RETENTION_MS = 8 * 86400_000;
const NEWS_LOOKBACK_MS = 24 * 3600_000;
const MAX_SIGNALS = 250;
const MAX_NEWS_ANALYSES = 500;
const MAX_EVIDENCE = 120;

type NewsSentiment = {
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: string;
  score: number;
  confidence: number;
  symbols: string[];
  summary: string;
};

function readNewsSentiment(value: Record<string, unknown>): NewsSentiment | null {
  const { headline, source, url, publishedAt, sentiment, score, confidence, symbols, summary } = value;
  if (
    typeof headline !== "string" || typeof source !== "string" || typeof url !== "string" ||
    typeof publishedAt !== "string" || !Number.isFinite(Date.parse(publishedAt)) ||
    typeof sentiment !== "string" || !["positive", "neutral", "negative"].includes(sentiment) ||
    typeof score !== "number" || score < -100 || score > 100 ||
    typeof confidence !== "number" || confidence < 0 || confidence > 1 ||
    !Array.isArray(symbols) || !symbols.every((symbol) => typeof symbol === "string") ||
    typeof summary !== "string"
  ) return null;
  return { headline, source, url, publishedAt, sentiment, score, confidence, symbols, summary };
}

export async function getSocialSentimentWorkspace() {
  const configuredX = getXProvider().health().configured;
  const configuredAi = hasSecret("GEMINI_API_KEY") || hasSecret("GROQ_API_KEY");
  if (!hasDatabase()) {
    return {
      configuredX, configuredAi, lastRun: null, activeProfiles: 0, profilesWithErrors: 0,
      overall: null, signals: [], staleSignals: [], weeklySignals: [], newsFallbacks: [], signalsTruncated: false,
    };
  }

  const db = getPostgresDb();
  const now = new Date();
  const signalCutoff = new Date(now.getTime() - SIGNAL_RETENTION_MS);
  const freshCutoff = new Date(now.getTime() - FRESH_X_MS);
  const newsCutoff = new Date(now.getTime() - NEWS_LOOKBACK_MS);
  const [signalRows, profileRows, [lastRun], overallRows, newsRows] = await Promise.all([
    db.select({
      id: schema.socialSignals.id,
      assetId: schema.socialSignals.assetId,
      symbol: schema.assets.symbol,
      name: schema.assets.name,
      providerAssetId: schema.assets.providerAssetId,
      modelKind: schema.socialSignals.modelKind,
      direction: schema.socialSignals.direction,
      label: schema.socialSignals.label,
      score: schema.socialSignals.score,
      confidence: schema.socialSignals.confidence,
      dimensions: schema.socialSignals.dimensions,
      explanation: schema.socialSignals.explanation,
      occurredAt: schema.socialSignals.occurredAt,
      status: schema.socialSignals.status,
    }).from(schema.socialSignals)
      .innerJoin(schema.assets, eq(schema.socialSignals.assetId, schema.assets.id))
      .where(and(
        inArray(schema.socialSignals.status, ["active", "expired"]),
        eq(schema.socialSignals.formulaVersion, SENTIMENT_FORMULA_VERSION),
        gte(schema.socialSignals.occurredAt, signalCutoff),
      ))
      .orderBy(desc(schema.socialSignals.occurredAt))
      .limit(MAX_SIGNALS + 1),
    db.select({
      active: schema.trackedAccounts.active,
      consecutiveFailures: schema.trackedAccountCursors.consecutiveFailures,
    }).from(schema.trackedAccounts)
      .leftJoin(schema.trackedAccountCursors, eq(schema.trackedAccountCursors.accountId, schema.trackedAccounts.id)),
    db.select({
      status: schema.automationRuns.status,
      message: schema.automationRuns.message,
      startedAt: schema.automationRuns.startedAt,
      completedAt: schema.automationRuns.completedAt,
    }).from(schema.automationRuns)
      .where(eq(schema.automationRuns.kind, "social_sentiment"))
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(1),
    db.select({
      score: schema.socialAnalyses.score,
      confidence: schema.socialAnalyses.confidence,
      sentiment: schema.socialAnalyses.sentiment,
    }).from(schema.socialAnalyses)
      .where(and(
        gte(schema.socialAnalyses.analyzedAt, new Date(now.getTime() - FRESH_X_MS)),
        isNull(schema.socialAnalyses.assetId),
      ))
      .orderBy(desc(schema.socialAnalyses.analyzedAt))
      .limit(500),
    db.select({
      result: schema.aiAnalyses.result,
      createdAt: schema.aiAnalyses.createdAt,
    }).from(schema.aiAnalyses)
      .where(and(
        eq(schema.aiAnalyses.kind, "news_sentiment_fallback"),
        gte(schema.aiAnalyses.createdAt, newsCutoff),
      ))
      .orderBy(desc(schema.aiAnalyses.createdAt))
      .limit(MAX_NEWS_ANALYSES),
  ]);

  const signalsTruncated = signalRows.length > MAX_SIGNALS;
  const boundedSignalRows = signalRows.slice(0, MAX_SIGNALS);
  const overall = aggregateSentiment(overallRows);
  const windowHours = (row: (typeof boundedSignalRows)[number]) => Number(row.dimensions.windowHours ?? 2);
  const latestByAsset = (rows: typeof boundedSignalRows) => {
    const latest = new Map<string, (typeof boundedSignalRows)[number]>();
    for (const row of rows) if (!latest.has(row.assetId)) latest.set(row.assetId, row);
    return [...latest.values()];
  };
  const shortRows = boundedSignalRows.filter((row) => windowHours(row) === 2);
  const weeklyRows = boundedSignalRows.filter((row) => windowHours(row) === 168);
  const trendByAsset = new Map<string, number[]>();
  for (const row of [...shortRows].reverse()) {
    const trend = trendByAsset.get(row.assetId);
    if (trend) trend.push(row.score);
    else trendByAsset.set(row.assetId, [row.score]);
  }
  const latestShort = latestByAsset(shortRows);
  const freshRows = latestShort.filter((row) => {
    const latestPublishedAt = row.dimensions.latestPublishedAt;
    return typeof latestPublishedAt === "string" && Date.parse(latestPublishedAt) >= freshCutoff.getTime();
  });
  const freshAssetIds = new Set(freshRows.map((row) => row.assetId));
  const staleRows = latestShort.filter((row) => !freshAssetIds.has(row.assetId));
  const latestWeekly = latestByAsset(weeklyRows);
  const evidenceSignalIds = [...freshRows, ...staleRows, ...latestWeekly].map((signal) => signal.id);
  const evidence = evidenceSignalIds.length ? await db.select({
    signalId: schema.socialSignalEvidence.signalId,
    authorHandle: schema.socialSignalEvidence.authorHandle,
    sourceUrl: schema.socialSignalEvidence.sourceUrl,
    publishedAt: schema.socialSignalEvidence.publishedAt,
    evidenceSummary: schema.socialSignalEvidence.evidenceSummary,
    evidenceData: schema.socialSignalEvidence.evidenceData,
  }).from(schema.socialSignalEvidence)
    .where(inArray(schema.socialSignalEvidence.signalId, evidenceSignalIds))
    .orderBy(desc(schema.socialSignalEvidence.publishedAt))
    .limit(MAX_EVIDENCE) : [];
  const evidenceBySignal = new Map<string, typeof evidence>();
  for (const row of evidence) evidenceBySignal.set(row.signalId, [...(evidenceBySignal.get(row.signalId) ?? []), row]);
  const visibleSignalIds = [...new Set([...freshRows, ...staleRows, ...latestWeekly].map((signal) => signal.id))];
  const outcomeRows = visibleSignalIds.length ? await db.select({
    signalId: schema.socialSignalOutcomes.signalId,
    horizonHours: schema.socialSignalOutcomes.horizonHours,
    status: schema.socialSignalOutcomes.status,
    returnPct: schema.socialSignalOutcomes.returnPct,
  }).from(schema.socialSignalOutcomes)
    .where(inArray(schema.socialSignalOutcomes.signalId, visibleSignalIds)) : [];
  const outcomesBySignal = new Map<string, typeof outcomeRows>();
  for (const row of outcomeRows) outcomesBySignal.set(row.signalId, [...(outcomesBySignal.get(row.signalId) ?? []), row]);

  const freshSymbols = new Set(freshRows.map((row) => row.symbol));
  const newsBySymbol = new Map<string, { data: NewsSentiment; publishedAt: Date }[]>();
  for (const row of newsRows) {
    const news = readNewsSentiment(row.result);
    if (!news || now.getTime() - Date.parse(news.publishedAt) > NEWS_LOOKBACK_MS) continue;
    for (const symbol of new Set(news.symbols.map((item) => item.toUpperCase()))) {
      if (freshSymbols.has(symbol)) continue;
      newsBySymbol.set(symbol, [...(newsBySymbol.get(symbol) ?? []), { data: news, publishedAt: new Date(news.publishedAt) }]);
    }
  }
  const newsSymbols = [...newsBySymbol.keys()];
  const newsAssets = newsSymbols.length ? await db.select({
    symbol: schema.assets.symbol,
    name: schema.assets.name,
  }).from(schema.assets).where(inArray(schema.assets.symbol, newsSymbols)) : [];
  const assetBySymbol = new Map(newsAssets.map((asset) => [asset.symbol.toUpperCase(), asset]));
  const newsFallbacks = [...newsBySymbol.entries()].flatMap(([symbol, items]) => {
    const asset = assetBySymbol.get(symbol);
    const aggregate = aggregateSentiment(items.map(({ data }) => data));
    if (!asset || !aggregate) return [];
    const latest = [...items].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0];
    return [{
      symbol,
      name: asset.name,
      ...aggregate,
      sampleCount: items.length,
      latestAt: latest.publishedAt.toISOString(),
      evidence: [...items]
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, 3)
        .map(({ data }) => ({
          headline: data.headline,
          source: data.source,
          url: data.url,
          publishedAt: data.publishedAt,
          summary: data.summary,
        })),
    }];
  }).sort((a, b) => b.latestAt.localeCompare(a.latestAt));

  const mapSignal = (signal: (typeof boundedSignalRows)[number]) => ({
    ...signal,
    occurredAt: signal.occurredAt.toISOString(),
    marketTracked: Boolean(signal.providerAssetId),
    dimensions: signal.dimensions as Record<string, number | string | boolean | null>,
    trend: trendByAsset.get(signal.assetId) ?? [],
    outcomes: (outcomesBySignal.get(signal.id) ?? []).sort((left, right) => left.horizonHours - right.horizonHours),
    evidence: (evidenceBySignal.get(signal.id) ?? []).slice(0, 3).map((item) => ({
      authorHandle: item.authorHandle,
      sourceUrl: item.sourceUrl,
      publishedAt: item.publishedAt.toISOString(),
      summary: item.evidenceSummary,
      contextReferences: Array.isArray(item.evidenceData.contextReferences)
        ? item.evidenceData.contextReferences.flatMap((reference) => {
          if (
            typeof reference !== "object" || reference === null ||
            typeof reference.sourceUrl !== "string" || typeof reference.symbol !== "string"
          ) return [];
          return [{ sourceUrl: reference.sourceUrl, symbol: reference.symbol }];
        })
        : [],
    })),
  });

  return {
    configuredX,
    configuredAi,
    lastRun: lastRun ? {
      status: lastRun.status,
      message: lastRun.message,
      startedAt: lastRun.startedAt.toISOString(),
      completedAt: lastRun.completedAt?.toISOString() ?? null,
    } : null,
    activeProfiles: profileRows.filter((profile) => profile.active).length,
    profilesWithErrors: profileRows.filter((profile) => profile.active && (profile.consecutiveFailures ?? 0) > 0).length,
    overall: overall ? { ...overall, sampleCount: overallRows.length } : null,
    signals: freshRows.map(mapSignal),
    staleSignals: staleRows.map(mapSignal),
    weeklySignals: latestWeekly.map(mapSignal),
    newsFallbacks,
    signalsTruncated,
  };
}
