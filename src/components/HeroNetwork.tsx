"use client";

import { useEffect, useRef } from "react";

/**
 * Animated peer network: nodes drift, nearby nodes link up, and packets travel
 * along links, like transactions propagating between peers. Five brighter nodes
 * stand for the five newsrooms; their packets converge on a central "story" node.
 *
 * Budget-conscious: ~1 draw per frame on a single canvas, capped node count and
 * pixel ratio, paused when off-screen or in a background tab, and a single static
 * frame for people who prefer reduced motion.
 */
type Node = { x: number; y: number; vx: number; vy: number; r: number; source?: boolean };
type Packet = { a: number; b: number; t: number; speed: number; hot: boolean };

const GREEN = "74, 222, 128";
const CYAN = "90, 215, 232";
const AMBER = "245, 176, 65";

export default function HeroNetwork() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, last = 0, spawnAt = 0;
    let nodes: Node[] = [];
    let packets: Packet[] = [];
    let hub = 0;
    const linkDist = () => Math.min(190, Math.max(120, w / 8));

    function build() {
      const rect = canvas!.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(90, Math.max(30, Math.round((w * h) / 8500)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: 1 + Math.random() * 1.4,
      }));
      // Five newsroom nodes on an arc, plus a hub where their stories merge (right side, behind no text)
      // Desktop: cluster sits right of the text. Mobile: above it.
      const narrow = w < 768;
      const cx = narrow ? w * 0.5 : w * 0.78;
      const cy = narrow ? h * 0.2 : h * 0.5;
      const rad = narrow ? Math.min(w * 0.3, h * 0.13) : Math.min(w, h) * 0.34;
      for (let i = 0; i < 5; i++) {
        const ang = -Math.PI / 2 + (i - 2) * 0.55 + Math.PI;
        nodes.push({ x: cx + Math.cos(ang) * rad * 1.1, y: cy + Math.sin(ang) * rad, vx: 0, vy: 0, r: 3, source: true });
      }
      nodes.push({ x: cx, y: cy, vx: 0, vy: 0, r: 5, source: true });
      hub = nodes.length - 1;
      packets = [];
    }

    function neighbours(i: number) {
      const out: number[] = [];
      const d2 = linkDist() ** 2;
      for (let j = 0; j < nodes.length; j++) {
        if (j === i) continue;
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
        if (dx * dx + dy * dy < d2) out.push(j);
      }
      return out;
    }

    function spawn() {
      if (packets.length > 40) return;
      if (Math.random() < 0.35) {
        // a newsroom sends a story to the hub
        const src = hub - 1 - Math.floor(Math.random() * 5);
        packets.push({ a: src, b: hub, t: 0, speed: 0.006 + Math.random() * 0.004, hot: true });
      } else {
        const a = Math.floor(Math.random() * (nodes.length - 6));
        const ns = neighbours(a);
        if (ns.length) packets.push({ a, b: ns[Math.floor(Math.random() * ns.length)], t: 0, speed: 0.012 + Math.random() * 0.012, hot: false });
      }
    }

    function draw(time: number) {
      const dt = Math.min(50, time - last || 16) / 16;
      last = time;
      ctx!.clearRect(0, 0, w, h);
      const ld = linkDist();

      for (const n of nodes) {
        if (n.source) continue;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.x < -20) n.x = w + 20; else if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20; else if (n.y > h + 20) n.y = -20;
      }

      // links
      ctx!.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const d = Math.hypot(dx, dy);
          if (d > ld) continue;
          ctx!.strokeStyle = `rgba(${GREEN}, ${0.24 * (1 - d / ld)})`;
          ctx!.beginPath();
          ctx!.moveTo(nodes[i].x, nodes[i].y);
          ctx!.lineTo(nodes[j].x, nodes[j].y);
          ctx!.stroke();
        }
      }
      // newsroom → hub spokes
      ctx!.setLineDash([2, 6]);
      ctx!.strokeStyle = `rgba(${AMBER}, 0.22)`;
      for (let k = 1; k <= 5; k++) {
        ctx!.beginPath();
        ctx!.moveTo(nodes[hub - k].x, nodes[hub - k].y);
        ctx!.lineTo(nodes[hub].x, nodes[hub].y);
        ctx!.stroke();
      }
      ctx!.setLineDash([]);

      // nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const color = i === hub ? AMBER : n.source ? CYAN : GREEN;
        ctx!.fillStyle = `rgba(${color}, ${n.source ? 0.95 : 0.55})`;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fill();
        if (n.source) {
          const pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(time / 600 + i);
          ctx!.strokeStyle = `rgba(${color}, ${0.15 + 0.25 * pulse})`;
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, n.r + 5 + pulse * 5, 0, Math.PI * 2);
          ctx!.stroke();
        }
      }

      // packets
      packets = packets.filter((p) => p.t <= 1);
      for (const p of packets) {
        p.t += p.speed * dt;
        const A = nodes[p.a], B = nodes[p.b];
        const x = A.x + (B.x - A.x) * p.t, y = A.y + (B.y - A.y) * p.t;
        const c = p.hot ? AMBER : GREEN;
        const g = ctx!.createRadialGradient(x, y, 0, x, y, p.hot ? 8 : 5);
        g.addColorStop(0, `rgba(${c}, 0.95)`);
        g.addColorStop(1, `rgba(${c}, 0)`);
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(x, y, p.hot ? 8 : 5, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function loop(time: number) {
      if (time > spawnAt) {
        spawn();
        spawnAt = time + 260;
      }
      draw(time);
      raf = requestAnimationFrame(loop);
    }

    function start() {
      cancelAnimationFrame(raf);
      if (reduce) {
        for (let i = 0; i < 8; i++) spawn();
        packets.forEach((p) => (p.t = Math.random()));
        draw(0);
      } else if (visible && document.visibilityState === "visible") {
        raf = requestAnimationFrame(loop);
      }
    }

    build();
    start();
    const ro = new ResizeObserver(() => {
      build();
      start();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
      else cancelAnimationFrame(raf);
    });
    io.observe(canvas);
    const onVis = () => (document.visibilityState === "visible" ? start() : cancelAnimationFrame(raf));
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 w-full h-full" />;
}
