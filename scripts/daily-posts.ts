import "./_env";
import { run } from "./_run";
import { runDailyPosts } from "../src/lib/jobs/daily-posts";

const trigger = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ? "manual" : process.env.GITHUB_ACTIONS ? "schedule" : "cli";
const force = process.argv.includes("--force") || process.env.FORCE === "true";
run("Daily posts", () => runDailyPosts({ trigger, force }));
