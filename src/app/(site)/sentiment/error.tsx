"use client";

export default function SentimentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="panel mx-auto my-8 grid max-w-2xl gap-3 p-6" role="alert">
      <h1 className="m-0 font-mono text-xl">Social sentiment is temporarily unavailable</h1>
      <p className="m-0 text-sm text-muted">The sentiment data could not be loaded. The rest of the site is still available; try loading this page again.</p>
      <button type="button" className="btn w-fit" onClick={reset}>Try again</button>
    </section>
  );
}
