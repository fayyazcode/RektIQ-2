"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/market", label: "Market" },
  { href: "/signals", label: "Signals" },
  { href: "/anomalies", label: "Anomalies" },
  { href: "/sentiment", label: "Social sentiment" },
  { href: "/degen", label: "Degen" },
  { href: "/news", label: "All news" },
  { href: "/sources", label: "Sources" },
  { href: "/posts", label: "X posts" },
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  // Lock body scroll when menu is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="relative md:hidden">
      {/* Backdrop overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Hamburger button */}
      <button
        className="relative z-50 flex flex-col justify-center items-center w-11 h-11 rounded border border-line text-muted hover:text-phosphor hover:border-phosphor-dim transition-colors focus-visible:outline-2 focus-visible:outline-amber"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        <span className="relative w-5 h-5 flex flex-col justify-center items-center">
          {/* Top line */}
          <span
            className={`block w-6 h-0.5 bg-current transition-all duration-300 ease-in-out origin-center ${
              open ? "rotate-45 translate-y-1" : "-translate-y-1 rotate-0"
            }`}
          />
          {/* Middle line */}
          <span
            className={`block w-6 h-0.5 bg-current transition-all duration-300 ease-in-out ${
              open ? "opacity-0 scale-0" : "opacity-100 scale-100"
            }`}
          />
          {/* Bottom line */}
          <span
            className={`block w-6 h-0.5 bg-current transition-all duration-300 ease-in-out origin-center ${
              open ? "-rotate-45 -translate-y-1" : "rotate-0 translate-y-1"
            }`}
          />
        </span>
      </button>

      {/* Dropdown menu */}
      <div
        className={`fixed right-4 left-4 top-full z-50 mt-2 origin-top-right bg-panel/95 backdrop-blur-lg border border-line rounded-md overflow-hidden transition-all duration-300 ease-in-out shadow-lg shadow-black/40 ${
          open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"
        }`}
        aria-hidden={!open}
        inert={!open}
      >
        <nav aria-label="Mobile">
          {LINKS.map((l, i) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`block px-4 py-2.5 font-term text-base no-underline transition-colors border-b border-line/30 last:border-0 ${
                  active
                    ? "bg-phosphor/20 text-phosphor border-l-2 border-phosphor"
                    : "text-muted hover:text-phosphor hover:bg-panel-2"
                }`}
                style={{ transitionDelay: open ? `${i * 30}ms` : "0ms" }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
