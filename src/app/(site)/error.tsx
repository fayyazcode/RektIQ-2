"use client";

import ErrorPanel from "@/components/ErrorPanel";

/** Keeps the site header and footer when a page fails. */
export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} reset={reset} />;
}
