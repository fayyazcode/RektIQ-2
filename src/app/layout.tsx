import type { Metadata, Viewport } from "next";
import "@fontsource/vt323/400.css";
import "@fontsource/press-start-2p/400.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./globals.css";
import { SITE } from "@/lib/config";
import TechBackground from "@/components/TechBackground";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name}: daily crypto news, duplicates merged`, template: `%s | ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  alternates: { canonical: "/", types: { "application/rss+xml": [{ url: "/feed.xml", title: `${SITE.name} RSS` }] } },
  openGraph: { type: "website", siteName: SITE.name, url: "/", title: SITE.name, description: SITE.description, locale: "en_US" },
  twitter: { card: "summary_large_image", ...(SITE.xHandle ? { site: SITE.xHandle } : {}) },
  robots: { index: true, follow: true, googleBot: { "max-image-preview": "large", "max-snippet": -1 } },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#000000", colorScheme: "dark light" };

/** Old hash-router URLs (/#/articles/â€¦) â†’ new routes. Runs before hydration. */
const LEGACY_HASH_REDIRECT = `(function(){var h=location.hash;if(h.indexOf("#/")!==0)return;var p=h.slice(1);var m={"/articles":"/news","/posts":"/posts","/admin":"/admin"};var t=m[p]||(p.indexOf("/admin")===0?"/admin":p.indexOf("/articles")===0?"/news":"/");location.replace(t);})();`;
const THEME_INITIALIZER = `(function(){var t=localStorage.getItem("reckt-iq-theme")==="light"?"light":"dark";var e=document.documentElement;e.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==="light"?"#f4f7f5":"#000000";})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INITIALIZER }} />
        <script dangerouslySetInnerHTML={{ __html: LEGACY_HASH_REDIRECT }} />
      </head>
      <body className="crt">
        <TechBackground />
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] btn bg-black">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
