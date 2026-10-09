import Link from "next/link";

export default function Pagination({ page, pages, makeHref }: { page: number; pages: number; makeHref: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-6 font-term text-xl">
      {page > 1 ? <Link className="btn btn-ghost" href={makeHref(page - 1)} rel="prev">Newer</Link> : <span />}
      <span className="text-muted">Page {page} of {pages}</span>
      {page < pages ? <Link className="btn btn-ghost" href={makeHref(page + 1)} rel="next">Older</Link> : <span />}
    </nav>
  );
}
