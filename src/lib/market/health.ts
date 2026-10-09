/**
 * Provider health tracking (Phase 13). In-process counters are mirrored to the
 * `provider_health` PostgreSQL table by the worker; API routes read the
 * collection. No secret values ever enter these records.
 */
import { z } from "zod";

export const ProviderHealthSchema = z.object({
  provider: z.string(),
  requests: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  rateLimits: z.number().int().nonnegative(),
  lastSuccessAt: z.string().nullable(), // ISO
  lastFailureAt: z.string().nullable(),
  lastError: z.string().max(300).nullable(),
  avgLatencyMs: z.number().nonnegative(),
  stale: z.boolean(),
  updatedAt: z.string(),
});

export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export class HealthTracker {
  private requests = 0;
  private errors = 0;
  private rateLimits = 0;
  private latencySum = 0;
  private lastSuccessAt: string | null = null;
  private lastFailureAt: string | null = null;
  private lastError: string | null = null;
  private stale = false;

  recordSuccess(ms: number, at = new Date().toISOString()) {
    this.requests++;
    this.latencySum += Math.max(0, ms);
    this.lastSuccessAt = at;
    this.stale = false;
    this.lastError = null;
  }

  recordError(ms: number, message: string, isRateLimit = false, at = new Date().toISOString()) {
    this.requests++;
    this.errors++;
    if (isRateLimit) this.rateLimits++;
    this.latencySum += Math.max(0, ms);
    this.lastFailureAt = at;
    this.lastError = message.slice(0, 300);
    this.stale = true;
  }

  snapshot(provider: string, at = new Date().toISOString()): ProviderHealth {
    return {
      provider,
      requests: this.requests,
      errors: this.errors,
      rateLimits: this.rateLimits,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      lastError: this.lastError,
      avgLatencyMs: this.requests ? Math.round(this.latencySum / this.requests) : 0,
      stale: this.stale,
      updatedAt: at,
    };
  }

  reset() {
    this.requests = 0;
    this.errors = 0;
    this.rateLimits = 0;
    this.latencySum = 0;
    this.lastSuccessAt = null;
    this.lastFailureAt = null;
    this.lastError = null;
    this.stale = false;
  }
}
