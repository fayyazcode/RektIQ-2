"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/**
 * Polls a tiny cached endpoint once a minute while the tab is visible and
 * offers to refresh when new stories arrive. News lands hourly, so this is
 * cheaper and more reliable on free hosting than a websocket server.
 */
export default function LiveUpdates({ since }: { since: string }) {
  const [count, setCount] = useState(0);
  const sinceRef = useRef(since);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    sinceRef.current = since;
    setCount(0);
  }, [since]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/live?since=${encodeURIComponent(sinceRef.current)}`, { cache: "no-store" });
          if (res.ok) setCount(((await res.json()) as { count: number }).count);
        } catch {
          /* offline: try again next tick */
        }
      }
      timer = setTimeout(poll, 60_000);
    };
    timer = setTimeout(poll, 60_000);
    return () => clearTimeout(timer);
  }, []);

  if (count === 0) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 no-print">
      <button type="button" className="btn bg-black shadow-lg" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        {pending ? "Loading…" : `${count} new ${count === 1 ? "story" : "stories"}. Show them`}
      </button>
    </div>
  );
}
