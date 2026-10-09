import "./_env";
import { run } from "./_run";
import { runCleanup } from "../src/lib/jobs/cleanup";

const trigger = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ? "manual" : process.env.GITHUB_ACTIONS ? "schedule" : "cli";
run("Daily cleanup", () => runCleanup(trigger));
