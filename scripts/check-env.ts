import "./_env";
import { envReport } from "../src/lib/env";

/** Lists which variables are set, never their values. */
const r = envReport();
const line = (x: { key: string; set: boolean }) => `  ${x.set ? "✓" : "·"} ${x.key}`;
console.log("Secrets:\n" + r.secrets.map(line).join("\n"));
console.log("Settings:\n" + r.config.map(line).join("\n"));
const missing = r.secrets.filter((x) => !x.set && ["DATABASE_URL", "SESSION_SECRET", "ADMIN_PASSWORD_HASH"].includes(x.key));
if (missing.length) {
  console.log(`\nRequired but missing: ${missing.map((m) => m.key).join(", ")}. Copy .env.example to .env.local and fill them in.`);
  process.exitCode = 1;
}
