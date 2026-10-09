import { requireAdmin } from "@/lib/auth/session";
import { SITE } from "@/lib/config";
import AdminShell from "../admin/(panel)/AdminShell";
import Dashboard from "../admin/(panel)/page";

export const dynamic = "force-dynamic";

export default async function DashboardAlias() {
  const { username } = await requireAdmin();
  return (
    <AdminShell username={username} siteName={SITE.name}>
      <Dashboard />
    </AdminShell>
  );
}
