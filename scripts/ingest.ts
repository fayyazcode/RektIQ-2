import "./_env";
import { run } from "./_run";
import { runIngest } from "../src/lib/jobs/ingest";
import { runBreakingAlerts } from "../src/lib/jobs/breaking";
import { runSummaries } from "../src/lib/jobs/summaries";
import { runNewsCorrelation } from "./news-correlation";

const trigger = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ? "manual" : process.env.GITHUB_ACTIONS ? "schedule" : "cli";
run("Hourly ingest", async () => {
  const r = await runIngest(trigger);
  const d = r.deltaVsPrevious.insertedDiff;
  // Run news correlation: compute observed market movement after publication for new articles.
  // This reuses the existing pipeline and the runNewsCorrelation pure function; it is
  // intentionally best-effort — if the market snapshot data is not yet persisted for a given
  // asset the record is simply skipped (no causation claimed, only correlation).
  try {
    const corr = await runNewsCorrelation();
    console.log("[ingest] news-correlation:", corr);
  } catch (err) {
    console.warn("[ingest] news-correlation failed:", err instanceof Error ? err.message : err);
  }
  // Then summarize major stories (the alert and the posts use those facts), and check whether
  // one is important enough to post now. Problems here never fail the ingest itself.
  const summaries = await runSummaries(trigger).catch((err: Error) => ({ status: "failed", message: `Summaries failed: ${err.message}` }));
  let breaking: { status: string; message?: string | null };
  try {
    breaking = await runBreakingAlerts(trigger);
  } catch (err) {
    breaking = { status: "failed", message: `Breaking alert check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ...r, summaries, breaking, message: `${r.message} Change vs previous run: ${d >= 0 ? "+" : ""}${d} new articles. ${summaries.message ?? ""} ${breaking.message ?? ""}` };
});
