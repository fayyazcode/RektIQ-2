import { appendFileSync } from "node:fs";
import { closeDb } from "../src/lib/db";
import { notifySite } from "../src/lib/notify-site";
import { describeConnection } from "../src/lib/db-info";

/** Runs a job, prints JSON, writes a GitHub Actions step summary, sets the exit code. */
export async function run(name: string, job: () => Promise<{ status: string; message?: string | null } & Record<string, unknown>>) {
  const started = Date.now();
  const where = describeConnection();
  const whereLine = where ? `Database: ${where.database} on ${where.cluster}` : "Database: DATABASE_URL is not set";
  console.log(whereLine);
  try {
    const result = await job();
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "failed" && result.status !== "skipped") console.log(await notifySite());
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      appendFileSync(summary, `### ${name}: ${result.status}\n\n${whereLine}\n\n${result.message ?? ""}\n\n<details><summary>Result</summary>\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n</details>\n`);
    }
    process.exitCode = result.status === "failed" ? 1 : 0;
  } catch (err) {
    console.error(`[${name}] failed after ${Date.now() - started} ms`, err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
