import { z } from "zod";
import { isValidSymbol } from "@/lib/realtime/protocol";

function parseLimit(raw: string | null, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error("invalid limit");
  if (n < 1 || n > 100) {
    // clamp overview to 100, but list queries also bounded 1..100
    if (n > 100) return 100;
    throw new Error("invalid limit");
  }
  return n;
}

export function parseMarketOverviewQuery(params: URLSearchParams): { symbols: string[]; limit: number } {
  const raw = params.get("symbols") ?? params.get("symbols[]") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .filter((s) => isValidSymbol(s));
  // also accept repeated ?symbol=BTC&symbol=ETH style via getAll
  for (const v of params.getAll("symbol")) {
    const u = v.trim().toUpperCase();
    if (u && isValidSymbol(u) && !symbols.includes(u)) symbols.push(u);
  }
  const limitRaw = params.get("limit");
  let limit: number;
  if (limitRaw == null) limit = 100;
  else {
    const n = Number(limitRaw);
    if (!Number.isFinite(n)) throw new Error("invalid limit");
    limit = n > 100 ? 100 : n < 1 ? 1 : Math.floor(n);
  }
  void parseLimit; // keep helper for future
  return { symbols, limit };
}

export function parseListQuery(params: URLSearchParams): { symbol?: string; type?: string; limit?: number; before?: string } {
  const out: { symbol?: string; type?: string; limit?: number; before?: string } = {};
  const sym = params.get("symbol");
  if (sym) {
    const u = sym.trim().toUpperCase();
    if (!isValidSymbol(u)) throw new Error("invalid symbol");
    out.symbol = u;
  }
  const type = params.get("type");
  if (type) out.type = type.trim();
  const limitRaw = params.get("limit");
  if (limitRaw != null && limitRaw !== "") {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 100) throw new Error("invalid limit");
    out.limit = n;
  }
  const before = params.get("before");
  if (before) {
    const d = new Date(before);
    if (isNaN(d.getTime())) throw new Error("invalid before");
    out.before = d.toISOString();
  }
  return out;
}

export function parseDegenQuery(params: URLSearchParams): { maxMarketCap: number } {
  const raw = params.get("maxMarketCap");
  if (raw == null || raw.trim() === "") return { maxMarketCap: 500_000_000 };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error("invalid maxMarketCap");
  if (n > 1e13) throw new Error("invalid maxMarketCap");
  return { maxMarketCap: Math.floor(n) };
}

// Shared pagination schema for reuse in routes
export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().datetime().optional(),
  symbol: z.string().regex(/^[A-Z0-9$\-.]{1,20}$/i).optional(),
});
