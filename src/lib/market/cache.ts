/**
 * Tiny in-process TTL cache with stale-while-error support, modelled on the
 * existing `publicQuery` pattern in src/lib/data/queries.ts (same idea, but it
 * also keeps expired values around so a provider failure can serve stale data
 * with an explicit `stale: true` flag instead of returning nothing.
 */

type Entry<T> = { value: T; expiresAt: number };

export class TtlCache {
  private map = new Map<string, Entry<unknown>>();

  set(key: string, value: unknown, ttlMs: number, now = Date.now()) {
    this.map.set(key, { value, expiresAt: now + ttlMs });
  }

  /** Fresh value or undefined. */
  get<T>(key: string, now = Date.now()): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt < now) return undefined;
    return e.value as T;
  }

  /** Value even when expired — callers must label it stale. */
  getStale<T>(key: string): T | undefined {
    const e = this.map.get(key);
    return e ? (e.value as T) : undefined;
  }

  delete(key: string) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

/** Deduplicates concurrent async work per key (single-flight). */
export async function singleFlight<T>(map: Map<string, Promise<T>>, key: string, fn: () => Promise<T>): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;
  const p = fn().finally(() => map.delete(key));
  map.set(key, p);
  return p;
}
