/**
 * Resolves the realtime worker URL for browser clients.
 * NEXT_PUBLIC_REALTIME_URL is the client-visible value (bundled into JS);
 * REALTIME_URL is the server-side fallback so Vercel env without the prefix
 * still works when mirrored at build time.
 */

export function resolveRealtimeUrl(env: Record<string, string | undefined>): string | undefined {
  const primary = env.NEXT_PUBLIC_REALTIME_URL?.trim();
  if (primary) return primary;
  const fallback = env.REALTIME_URL?.trim();
  if (fallback) return fallback;
  return undefined;
}
