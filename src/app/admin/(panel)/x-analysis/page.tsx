import { desc, eq } from "drizzle-orm";
import { getPostgresDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const ANALYSIS_LIMIT = 100;

function sentimentColor(sentiment: string) {
  if (sentiment === "positive") return "text-phosphor";
  if (sentiment === "negative") return "text-danger";
  return "text-cyan";
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value) + " UTC";
}

export default async function XAnalysisPage() {
  const analyses = await getPostgresDb()
    .select({
      id: schema.socialAnalyses.id,
      modelKind: schema.socialAnalyses.modelKind,
      sentiment: schema.socialAnalyses.sentiment,
      score: schema.socialAnalyses.score,
      confidence: schema.socialAnalyses.confidence,
      summary: schema.socialAnalyses.summary,
      provider: schema.socialAnalyses.provider,
      model: schema.socialAnalyses.model,
      analyzedAt: schema.socialAnalyses.analyzedAt,
      symbol: schema.assets.symbol,
      assetName: schema.assets.name,
      authorHandle: schema.socialAnalysisEvidence.authorHandle,
      sourceUrl: schema.socialAnalysisEvidence.sourceUrl,
      publishedAt: schema.socialAnalysisEvidence.publishedAt,
      rawText: schema.socialPosts.rawText,
    })
    .from(schema.socialAnalyses)
    .innerJoin(schema.socialAnalysisEvidence, eq(schema.socialAnalysisEvidence.analysisId, schema.socialAnalyses.id))
    .leftJoin(schema.assets, eq(schema.assets.id, schema.socialAnalyses.assetId))
    .leftJoin(schema.socialPosts, eq(schema.socialPosts.id, schema.socialAnalysisEvidence.postId))
    .orderBy(desc(schema.socialAnalyses.analyzedAt))
    .limit(ANALYSIS_LIMIT);

  const sentiments = {
    positive: analyses.filter((analysis) => analysis.sentiment === "positive").length,
    neutral: analyses.filter((analysis) => analysis.sentiment === "neutral").length,
    negative: analyses.filter((analysis) => analysis.sentiment === "negative").length,
  };
  const averageScore = analyses.length
    ? analyses.reduce((total, analysis) => total + analysis.score, 0) / analyses.length
    : null;
  const averageConfidence = analyses.length
    ? analyses.reduce((total, analysis) => total + analysis.confidence, 0) / analyses.length
    : null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="m-0 font-mono text-2xl">X post analysis</h1>
        <p className="m-0 mt-2 text-sm text-muted">Recent post-level sentiment classifications from tracked X profiles. Showing up to the latest {ANALYSIS_LIMIT} analysis records.</p>
      </div>

      <section aria-label="Analysis summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Analysis records", value: analyses.length },
          { label: "Positive", value: sentiments.positive },
          { label: "Neutral", value: sentiments.neutral },
          { label: "Negative", value: sentiments.negative },
          {
            label: "Average score / confidence",
            value: averageScore === null || averageConfidence === null
              ? "—"
              : `${averageScore > 0 ? "+" : ""}${averageScore.toFixed(1)} / ${Math.round(averageConfidence * 100)}%`,
          },
        ].map((item) => (
          <div key={item.label} className="panel min-w-0 p-4">
            <p className="label m-0">{item.label}</p>
            <p className="m-0 mt-2 break-words font-mono text-2xl">{item.value}</p>
          </div>
        ))}
      </section>

      {!analyses.length ? (
        <p className="panel m-0 p-5 text-sm text-muted">No X post analyses are available yet. They will appear after the social sentiment worker processes tracked posts.</p>
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0">
          {analyses.map((analysis) => (
            <li key={analysis.id} className="panel grid min-w-0 gap-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 font-mono text-sm">
                    <a href={analysis.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-phosphor">
                      @{analysis.authorHandle} on X ↗
                    </a>
                    {analysis.assetName && analysis.symbol && (
                      <span className="text-muted"> · {analysis.assetName} ({analysis.symbol})</span>
                    )}
                  </p>
                  <p className="m-0 mt-1 text-xs text-muted">
                    Published {formatTime(analysis.publishedAt)} · analyzed {formatTime(analysis.analyzedAt)} · {analysis.modelKind === "onchain" ? "On-chain" : "Major-market"} profiles
                  </p>
                </div>
                <span className={`font-term text-xl ${sentimentColor(analysis.sentiment)}`}>{analysis.sentiment}</span>
              </div>

              {analysis.rawText
                ? <p className="m-0 whitespace-pre-wrap break-words text-sm">{analysis.rawText}</p>
                : <p className="m-0 text-sm text-muted">Original post text is no longer retained.</p>}
              <p className="m-0 break-words text-sm text-muted">{analysis.summary}</p>

              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
                <span>Score <b className="font-mono text-text">{analysis.score > 0 ? "+" : ""}{analysis.score}/100</b></span>
                <span>Confidence <b className="font-mono text-text">{Math.round(analysis.confidence * 100)}%</b></span>
                <span>Model <b className="font-mono text-text">{analysis.provider}/{analysis.model}</b></span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
