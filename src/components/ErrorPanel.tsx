"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useState } from "react";

const DB_HINT = /postgres|database|timed out|timeout|ECONN|ETIMEDOUT|connection|socket/i;

/**
 * Shared error UI. In development it shows the real error so problems can be diagnosed;
 * in production Next hides server error details, so it shows the reference id instead.
 * Database-looking errors retry once automatically in case the connection is transient.
 */
export default function ErrorPanel({ error, reset, compact = false }: { error: Error & { digest?: string }; reset: () => void; compact?: boolean }) {
  const dev = process.env.NODE_ENV !== "production";
  const looksLikeDb = DB_HINT.test(error.message);
  const shouldAutoRetry = looksLikeDb || !dev;
  const [left, setLeft] = useState<number | null>(null);
  const router = useRouter();
  // Server-rendered pages need a fresh server render, not just a client re-render.
  const retry = useCallback(() => startTransition(() => { router.refresh(); reset(); }), [router, reset]);

  useEffect(() => {
    console.error(error);
    if (!shouldAutoRetry) return;
    const key = `rektoiq-auto-retry:${location.pathname}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      setTimeout(() => sessionStorage.removeItem(key), 60_000);
    } catch {}
    setLeft(5);
  }, [error, shouldAutoRetry]);

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      setLeft(null);
      retry();
      return;
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left, retry]);

  return (
    <div className={compact ? "panel p-6 max-w-2xl" : "mx-auto max-w-2xl px-4 py-24 text-center"}>
      <p className="font-term text-3xl text-danger m-0 mb-3">Error</p>
      <h1 className="font-mono text-2xl m-0 mb-3">This page didn&apos;t load</h1>
      <p className="text-muted mb-4">
        {looksLikeDb
          ? "The database took too long to answer. On the free tier this usually happens right after it has been idle, and the next try is faster."
          : dev
            ? "Something went wrong while building this page."
            : "The server couldn't load this page. Check the runtime logs if it keeps happening."}
      </p>
      {dev && <pre className="text-left text-sm text-danger bg-black border border-line rounded p-3 overflow-x-auto whitespace-pre-wrap mb-4">{error.message}</pre>}
      {!dev && error.digest && <p className="text-sm text-dim mb-4">Reference: {error.digest}</p>}
      <button type="button" className="btn" onClick={retry}>{left ? `Retrying in ${left}s` : "Try again"}</button>
    </div>
  );
}
