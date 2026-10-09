"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useRealtime, type RealtimeState } from "@/lib/realtime/useRealtime";

type RealtimeContextValue = RealtimeState & {
  subscribeAsset: (symbol: string) => { ok: boolean; error?: string };
  unsubscribeAsset: (symbol: string) => void;
  joinMemecoins: () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children, url, authToken }: { children: ReactNode; url?: string; authToken?: string }) {
  const value = useRealtime({ url, authToken });
  return <RealtimeContext.Provider value={value as RealtimeContextValue}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeContext(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtimeContext must be used within RealtimeProvider");
  return ctx;
}

/** Safe hook that returns null outside the provider (for optional UI). */
export function useRealtimeOptional(): RealtimeContextValue | null {
  return useContext(RealtimeContext);
}
