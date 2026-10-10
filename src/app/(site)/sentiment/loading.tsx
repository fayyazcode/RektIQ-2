import PageHero from "@/components/PageHero";

export default function SentimentLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHero variant="sentiment" kicker="MEMBER WORKSPACE" title="Social sentiment">
        <p className="text-sm md:text-base">Loading tracked-post sentiment and collection status…</p>
      </PageHero>
      <section className="panel grid gap-3 p-4 sm:p-5">
        <h2 className="label m-0 text-phosphor">Loading collection status</h2>
        <div className="h-4 max-w-md animate-pulse rounded bg-panel-2" />
      </section>
      <section className="panel min-h-40 animate-pulse" aria-hidden="true" />
    </div>
  );
}
