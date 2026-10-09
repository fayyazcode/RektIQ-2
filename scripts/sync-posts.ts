import "./_env";
import { run } from "./_run";
import { runPostSync } from "../src/lib/jobs/sync-posts";

const trigger = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ? "manual" : process.env.GITHUB_ACTIONS ? "schedule" : "cli";
run("Post sync", () => runPostSync(trigger));
