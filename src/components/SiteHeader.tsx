import Image from "next/image";
import Link from "next/link";
import logo from "@/app/logo.svg";
import { SITE } from "@/lib/config";
import type { Price } from "@/lib/prices";
import Ticker from "./Ticker";
import NavLinks from "./NavLinks";
import MobileNav from "./MobileNav";
import ThemeToggle from "./ThemeToggle";

export default function SiteHeader({ prices }: { prices: Price[] }) {
  return (
    <header className="site-header sticky top-0 z-50 backdrop-blur border-b border-line no-print">
      <Ticker prices={prices} />
      <div className="mx-auto max-w-6xl px-2 sm:px-4 py-2 sm:py-3 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <Link href="/" className="flex items-center gap-2 no-underline" aria-label={`${SITE.name} home`}>
          <span aria-hidden="true" className="site-brand-mark">
            <Image src={logo} alt="" width={48} height={48} priority />
          </span>
          <span className="font-pixel text-phosphor text-[0.7rem] sm:text-xs tracking-wider">{SITE.name}</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <NavLinks />
          <ThemeToggle />
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
