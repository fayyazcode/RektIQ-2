"use client";

import ErrorPanel from "@/components/ErrorPanel";

/** Keeps the admin sidebar when a page fails. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} reset={reset} compact />;
}
