"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import { resolveRealtimeUrl } from "./url";
import { isValidSymbol, REALTIME_EVENTS } from "./protocol";
import type { MarketBatch } from "@/lib/market/types";

export type RealtimeStatus = "connecting" | "connected" | "disconnected";

export type RealtimeState = {
  status: RealtimeStatus;
  stale: boolean;
  lastUpdated: string | null;
  batch: MarketBatch | null;
  tickMs: number | null;
  error: string | null;
};

export type UseRealtimeOptions = {
  url?: string;
  authToken?: string;
  autoConnect?: boolean;
};

export function useRealtime(opts: UseRealtimeOptions = {}) {
  const resolvedUrl =
    opts.url ??
    resolveRealtimeUrl({
      NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL,
      REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL ? undefined : undefined,
    });

  const authToken = opts.authToken ?? process.env.NEXT_PUBLIC_REALTIME_AUTH_TOKEN ?? undefined;

  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<RealtimeState>({
    status: resolvedUrl ? "connecting" : "disconnected",
    stale: true,
    lastUpdated: null,
    batch: null,
    tickMs: null,
    error: resolvedUrl ? null : "NEXT_PUBLIC_REALTIME_URL not set",
  });

  const subscribeAsset = useCallback((symbol: string) => {
    if (!isValidSymbol(symbol)) return { ok: false, error: "invalid symbol" };
    socketRef.current?.emit(REALTIME_EVENTS.SUBSCRIBE_ASSET, symbol.toUpperCase());
    return { ok: true };
  }, []);

  const unsubscribeAsset = useCallback((symbol: string) => {
    if (!isValidSymbol(symbol)) return;
    socketRef.current?.emit(REALTIME_EVENTS.UNSUBSCRIBE_ASSET, symbol.toUpperCase());
  }, []);

  const joinMemecoins = useCallback(() => {
    socketRef.current?.emit(REALTIME_EVENTS.JOIN_MEMECOINS);
  }, []);

  useEffect(() => {
    if (!resolvedUrl) return;
    if (opts.autoConnect === false) return;

    const socket: Socket = io(resolvedUrl, {
      auth: authToken ? { token: authToken } : undefined,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });
    socketRef.current = socket;

    const onConnect = () => setState((s) => ({ ...s, status: "connected", error: null }));
    const onDisconnect = () => setState((s) => ({ ...s, status: "disconnected" }));
    const onConnectError = (err: Error) => setState((s) => ({ ...s, status: "disconnected", error: err.message }));
    const onMarketUpdate = (batch: MarketBatch) =>
      setState((s) => ({ ...s, batch, stale: batch.stale, lastUpdated: batch.fetchedAt || new Date().toISOString(), tickMs: s.tickMs }));
    const onSystemStatus = (payload: { stale: boolean; tickMs: number }) =>
      setState((s) => ({ ...s, stale: payload.stale, tickMs: payload.tickMs }));

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on(REALTIME_EVENTS.MARKET_UPDATE, onMarketUpdate);
    socket.on(REALTIME_EVENTS.SYSTEM_STATUS, onSystemStatus);

    // Re-join market:all is automatic on reconnect (server does it on connection),
    // but asset rooms need re-join — consumers should re-call subscribeAsset on reconnect
    // if they need persistence. We expose status so they can.

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off(REALTIME_EVENTS.MARKET_UPDATE, onMarketUpdate);
      socket.off(REALTIME_EVENTS.SYSTEM_STATUS, onSystemStatus);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [resolvedUrl, authToken, opts.autoConnect]);

  return { ...state, subscribeAsset, unsubscribeAsset, joinMemecoins, socket: socketRef.current };
}
