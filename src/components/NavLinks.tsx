"use client";

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

export default function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="hidden md:flex gap-1 font-term text-sm sm:text-xl flex-wrap">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`px-3 py-1 rounded no-underline transition-colors ${active ? "bg-phosphor text-black" : "text-muted hover:text-phosphor"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
