import { run } from "./_run";
import { runSocialSentiment } from "../src/lib/jobs/social-sentiment";

run("Social sentiment", () => runSocialSentiment("schedule"));
