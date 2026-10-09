import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-24 text-center">
      <p className="font-term text-3xl text-danger m-0 mb-3">404</p>
      <h1 className="font-mono text-2xl m-0 mb-3">This page isn&apos;t here</h1>
      <p className="text-muted mb-6">The link may be old, or the story was never published here. The latest news is on the front page.</p>
      <Link href="/" className="btn">Go to the front page</Link>
    </main>
  );
}
