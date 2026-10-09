/** Fixed, site-wide backdrop: circuit-style grid, dot matrix and two slow-drifting glows. */
export default function TechBackground() {
  return (
    <div aria-hidden="true" className="tech-bg">
      <div className="tech-bg-grid" />
      <div className="tech-bg-glow tech-bg-glow-a" />
      <div className="tech-bg-glow tech-bg-glow-b" />
      <div className="tech-bg-vignette" />
    </div>
  );
}
