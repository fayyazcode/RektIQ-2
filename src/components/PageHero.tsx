/**
 * Header band for inner pages: a receding grid "floor" that scrolls toward the
 * viewer, a sweeping scan beam, and a soft glow. Pure CSS (see globals.css).
 */
type HeroVariant = "news" | "category" | "sources" | "source" | "posts" | "about" | "market" | "asset" | "signals" | "anomalies" | "sentiment" | "degen" | "story";

function HeroArtwork({ variant }: { variant: HeroVariant }) {
  if (variant === "category") return <div className="hero-art hero-art-category" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>;
  if (variant === "market" || variant === "asset") return <svg viewBox="0 0 420 180" className="hero-art hero-art-chart" aria-hidden="true"><path d="M0 145h420M0 95h420M0 45h420"/><path className="hero-chart-line" d="m0 130 45-12 28 18 35-46 38 20 35-55 30 32 32-14 32 25 34-61 36 20 35-36 40 10"/><path className="hero-chart-area" d="m0 130 45-12 28 18 35-46 38 20 35-55 30 32 32-14 32 25 34-61 36 20 35-36 40 10v149H0z"/></svg>;
  if (variant === "signals") return <div className="hero-art hero-art-wave" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>;
  if (variant === "anomalies") return <div className="hero-art hero-art-radar" aria-hidden="true"><i/><i/><i/><b/><b/><b/></div>;
  if (variant === "sentiment") return (
    <div className="hero-art hero-art-sentiment" aria-hidden="true">
      <div className="sentiment-stage sentiment-posts">
        <span className="sentiment-stage-label">TRACKED POSTS</span>
        <div className="sentiment-post-card"><i>“</i><span><b/><b/></span></div>
        <div className="sentiment-post-card"><i>“</i><span><b/><b/></span></div>
        <div className="sentiment-post-card"><i>“</i><span><b/><b/></span></div>
      </div>
      <div className="sentiment-connector"><i/></div>
      <div className="sentiment-stage sentiment-classifier">
        <span className="sentiment-stage-label">CLASSIFY</span>
        <div className="sentiment-class-row"><i>+</i><b/></div>
        <div className="sentiment-class-row"><i>~</i><b/></div>
        <div className="sentiment-class-row"><i>−</i><b/></div>
      </div>
      <div className="sentiment-connector"><i/></div>
      <div className="sentiment-stage sentiment-trend">
        <span className="sentiment-stage-label">AGGREGATE</span>
        <svg viewBox="0 0 120 72" role="presentation">
          <path className="sentiment-chart-grid" d="M0 18H120M0 36H120M0 54H120"/>
          <path className="sentiment-chart-line" d="m3 55 18-9 15 5 18-25 17 12 17-17 14 8 15-13"/>
        </svg>
        <span className="sentiment-trend-label">SIGNAL TREND</span>
      </div>
    </div>
  );
  if (variant === "degen") return <div className="hero-art hero-art-points" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 96}%`, top: `${(i * 53) % 88}%`, animationDelay: `${i * -130}ms` }} />)}</div>;
  if (variant === "sources" || variant === "source") return <div className="hero-art hero-art-feed" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div>;
  if (variant === "posts") return <div className="hero-art hero-art-terminal" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/></div>;
  if (variant === "about") return <div className="hero-art hero-art-orbit" aria-hidden="true"><i/><i/><i/></div>;
  return <div className="hero-art hero-art-editorial" aria-hidden="true"><i/><i/><i/></div>;
}

export default function PageHero({ title, children, kicker, variant = "news" }: { title: React.ReactNode; children?: React.ReactNode; kicker?: React.ReactNode; variant?: HeroVariant }) {
  return (
    <section className={`page-hero hero-${variant} relative overflow-hidden rounded-2xl border border-line mb-8 isolate`}>
      <div aria-hidden="true" className="hero-grid" />
      <div aria-hidden="true" className="hero-beam" />
      <div aria-hidden="true" className="hero-glow" />
      <HeroArtwork variant={variant} />
      <div className="relative z-[1] px-6 py-8 md:px-10 md:py-12">
        {kicker && <p className="font-term text-xl text-phosphor m-0 mb-2">{kicker}</p>}
        <h1 className="font-mono font-bold text-3xl md:text-4xl leading-tight m-0 mb-3 max-w-[30ch]">{title}</h1>
        {children && <div className="text-muted max-w-[65ch] m-0">{children}</div>}
      </div>
    </section>
  );
}
