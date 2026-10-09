export default function SetupNotice() {
  return (
    <div className="panel p-6 mb-6 border-amber/50">
      <p className="font-term text-2xl text-amber m-0 mb-2">Database not connected</p>
      <p className="m-0 text-muted max-w-[65ch]">
        Set <code className="text-ink">DATABASE_URL</code> to your Supabase PostgreSQL connection string, apply the Supabase schema, then run{" "}
        <code className="text-ink">npm run job:ingest</code> once to load the first stories. After that the hourly GitHub Action keeps them fresh.
      </p>
    </div>
  );
}
