import { env, secret } from "./env";

/** Triggers a GitHub Actions workflow (used by the admin "Run now" buttons). */
export async function dispatchWorkflow(workflowFile: "hourly-ingest.yml" | "daily-posts.yml" | "daily-cleanup.yml" | "post-sync.yml", inputs: Record<string, string> = {}) {
  const repo = env.githubRepo();
  const token = secret("GITHUB_DISPATCH_TOKEN");
  if (!repo || !token) throw new Error("Set GITHUB_REPO and GITHUB_DISPATCH_TOKEN to run jobs from the admin panel.");
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: env.githubRef(), inputs }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status !== 204) throw new Error(`GitHub returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
