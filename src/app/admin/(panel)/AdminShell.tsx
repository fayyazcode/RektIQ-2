"use client";

import Link from "next/link";
import { useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import { logoutAction } from "../actions";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: "grid" },
  { href: "/admin/runs", label: "Runs", icon: "activity" },
  { href: "/admin/posts", label: "Post queue", icon: "inbox" },
  { href: "/admin/sources", label: "Sources", icon: "rss" },
  { href: "/admin/access", label: "Access", icon: "users" },
  { href: "/admin/profiles", label: "X Profiles", icon: "at" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
] as const;

function NavIcon({ name }: { name: (typeof NAV)[number]["icon"] }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" {...common}>
      {name === "grid" && <><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></>}
      {name === "activity" && <><path d="M3 12h4l3-8 4 16 3-8h4" /></>}
      {name === "inbox" && <><path d="M4 4h16l1 11h-6l-2 3h-2l-2-3H3L4 4Z" /><path d="M4 4l2 7h12l2-7" /></>}
      {name === "rss" && <><path d="M5 19h.01M5 12a7 7 0 0 1 7 7M5 5a14 14 0 0 1 14 14" /><circle cx="5" cy="19" r="1" /></>}
      {name === "users" && <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.5-3.3 2.5-5 5.5-5s5 1.7 5.5 5" /><path d="M16 5.5a3 3 0 0 1 0 5.5M17 15c2.1.4 3.3 1.9 3.5 4" /></>}
      {name === "at" && <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /><path d="M15 12v1.5a2 2 0 0 0 4 0V12" /></>}
      {name === "settings" && <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.3 1-1.3 2.2-1.6-.6a8 8 0 0 1-1.6.9l-.3 1.7h-2.6l-.3-1.7a8 8 0 0 1-1.6-.9l-1.6.6-1.3-2.2 1.3-1a7 7 0 0 1 0-1.9l-1.3-1 1.3-2.2 1.6.6a8 8 0 0 1 1.6-.9l.3-1.7h2.6l.3 1.7a8 8 0 0 1 1.6.9l1.6-.6 1.3 2.2-1.3 1a7 7 0 0 1 0 1.8Z" transform="translate(-1 -1) scale(1.08)" /></>}
    </svg>
  );
}

export default function AdminShell({ children, username, siteName }: { children: React.ReactNode; username: string; siteName: string }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`min-h-dvh grid grid-cols-1 transition-[grid-template-columns] duration-200 ${collapsed ? "md:grid-cols-[4.5rem_minmax(0,1fr)]" : "md:grid-cols-[14rem_minmax(0,1fr)]"}`}>
      <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 border-b border-line bg-panel p-3 md:flex md:flex-col md:items-stretch md:gap-5 md:border-b-0 md:border-r md:p-4">
        <div className={`flex min-w-0 items-center ${collapsed ? "md:justify-center" : "justify-between"}`}>
          <Link href="/" title={siteName} className={`font-pixel text-phosphor text-[0.65rem] no-underline truncate ${collapsed ? "md:hidden" : ""}`}>{siteName}</Link>
          <ThemeToggle />
          <button type="button" onClick={() => setCollapsed((value) => !value)} className="hidden md:inline-flex size-9 shrink-0 items-center justify-center rounded text-muted hover:text-phosphor hover:bg-panel-2" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {collapsed ? <><path d="M9 5 16 12l-7 7" /><path d="M4 5v14" /></> : <><path d="m15 5-7 7 7 7" /><path d="M20 5v14" /></>}
            </svg>
          </button>
        </div>
        <nav aria-label="Admin" className="col-span-2 -mx-3 flex min-w-0 max-w-[calc(100%+1.5rem)] gap-1 overflow-x-auto px-3 pb-1 font-term text-xl md:mx-0 md:max-w-full md:flex-col md:overflow-visible md:p-0">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} prefetch={false} title={collapsed ? item.label : undefined} aria-label={item.label} className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded px-2 py-2 text-muted no-underline hover:text-phosphor hover:bg-panel-2 md:gap-3 ${collapsed ? "md:justify-center md:px-0 md:w-10 md:mx-auto" : ""}`}>
              <NavIcon name={item.icon} /><span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
            </Link>
          ))}
        </nav>
        <form action={logoutAction} className={`col-start-2 row-start-1 flex items-center justify-self-end gap-2 text-sm text-muted md:mt-auto md:justify-self-auto ${collapsed ? "md:flex-col" : ""}`}>
          <span className={collapsed ? "md:hidden" : ""}>{username}</span>
          <button className="btn btn-ghost !text-base !py-1 !px-2 !min-h-0">Sign out</button>
        </form>
      </aside>
      <main id="main" className="p-4 md:p-8 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}
