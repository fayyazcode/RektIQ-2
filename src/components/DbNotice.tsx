import { databaseUnavailable } from "@/lib/data/queries";
import RetrySoon from "./RetrySoon";

/**
 * Shown when Supabase PostgreSQL didn't answer in time for this request. Render it AFTER the
 * page's queries have been awaited. It retries once by itself: on a free cluster
 * the second attempt may succeed after the connection is established.
 */
export default function DbNotice() {
  if (!databaseUnavailable()) return null;
  return (
    <div role="status" className="panel p-5 mb-6 border-amber/50 flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="font-term text-2xl text-amber m-0">Still connecting to the database</p>
        <p className="text-muted text-sm m-0">The free database tier can take a few seconds to wake up. Some stories may be missing until it does.</p>
      </div>
      <RetrySoon />
    </div>
  );
}
