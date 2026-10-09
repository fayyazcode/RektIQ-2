import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { SITE } from "@/lib/config";
import AdminShell from "./AdminShell";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { username } = await requireAdmin();
  return (
    <AdminShell username={username} siteName={SITE.name}>{children}</AdminShell>
  );
}
