"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

const KEY = "rektoiq-db-retry";

export default function RetrySoon({ seconds = 6 }: { seconds?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    // Retry automatically only once per page, so a database that's really down doesn't cause a loop.
    let auto = true;
    try {
      auto = sessionStorage.getItem(KEY) !== location.pathname + location.search;
      sessionStorage.setItem(KEY, location.pathname + location.search);
    } catch {}
    if (!auto) return;
    setLeft(seconds);
    const id = setInterval(() => {
      setLeft((n) => {
        if (n === null) return n;
        if (n <= 1) {
          clearInterval(id);
          startTransition(() => router.refresh());
          return null;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  return (
    <button type="button" className="btn" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? "Loading…" : left ? `Retrying in ${left}s` : "Try again"}
    </button>
  );
}
