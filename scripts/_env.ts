/**
 * Loads .env, .env.local etc. the same way `next dev` does, so `npm run job:*`
 * works locally. In GitHub Actions the variables come from secrets and nothing
 * is overwritten. Must be the first import of every script.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
