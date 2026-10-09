import { getPostgresDb, closePostgresDb } from "./db/client";

export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

/** Initialize the shared PostgreSQL client; connections are opened lazily. */
export function warmDb() {
  if (!process.env.DATABASE_URL?.trim()) return;
  getPostgresDb();
}

/** Close the shared PostgreSQL client pool. */
export async function closeDb() {
  await closePostgresDb();
}