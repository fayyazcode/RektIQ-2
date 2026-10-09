import { it, expect } from "vitest";
import { describeConnection } from "@/lib/db-info";
import { warmDb } from "@/lib/db";

it("reports the Supabase PostgreSQL host and database without credentials", () => {
  process.env.DATABASE_URL = "postgresql://user:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
  expect(describeConnection()).toEqual({ cluster: "aws-0-us-east-1.pooler.supabase.com:6543", database: "postgres" });

  delete process.env.DATABASE_URL;
  expect(describeConnection()).toBeNull();
});

it("does not prevent server startup when DATABASE_URL is not configured", () => {
  const previous = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    expect(() => warmDb()).not.toThrow();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
