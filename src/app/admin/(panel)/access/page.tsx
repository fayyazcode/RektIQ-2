import ActionForm from "@/app/admin/ActionForm";
import { decideMemberAccessAction } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/auth/session";
import { getPostgresDb } from "@/lib/db/client";
import { memberProfiles } from "@/lib/db/schema";
import { fmtDateTime } from "@/lib/format";
import { getAdminAuthUsers } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const STATUS_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected", revoked: "Revoked" } as const;

export default async function AccessPage() {
  await requireAdmin();
  const profiles = await getPostgresDb().select().from(memberProfiles).orderBy(memberProfiles.requestedAt);
  let users: Awaited<ReturnType<typeof getAdminAuthUsers>> | null = null;
  let authError: string | null = null;
  try { users = await getAdminAuthUsers(); } catch (error) { authError = error instanceof Error ? error.message : "Unable to load member email addresses."; }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="m-0 font-mono text-2xl">Access queue</h1>
        <p className="m-0 mt-2 max-w-[70ch] text-sm text-muted">Approve only members whose email is confirmed in Supabase Auth. Every decision records the bootstrap administrator, time, and optional note.</p>
      </div>
      {authError && <p role="alert" className="panel m-0 border-danger/50 p-4 text-sm text-danger">{authError}</p>}
      {!profiles.length && <p className="panel m-0 p-5 text-sm text-muted">No member access requests yet.</p>}
      <ul className="m-0 grid list-none gap-4 p-0 xl:grid-cols-2">
        {profiles.map((profile) => {
          const user = users?.get(profile.userId);
          const canApprove = profile.approvalStatus === "pending" || profile.approvalStatus === "rejected" || profile.approvalStatus === "revoked";
          return (
            <li key={profile.userId} className="panel grid min-w-0 gap-4 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="m-0 break-all font-mono text-lg">{user?.email ?? "Auth identity unavailable"}</h2>
                  <p className="m-0 mt-1 text-xs text-muted">Requested {fmtDateTime(profile.requestedAt)}</p>
                </div>
                <span className={`chip ${profile.approvalStatus === "approved" ? "text-phosphor" : profile.approvalStatus === "pending" ? "text-amber" : "text-muted"}`}>{STATUS_LABEL[profile.approvalStatus]}</span>
              </div>
              <dl className="m-0 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                <dt className="text-muted">Email confirmed</dt><dd className="m-0">{user ? (user.emailConfirmed ? "Yes" : "No") : "Unavailable"}</dd>
                <dt className="text-muted">Last decision</dt><dd className="m-0">{profile.decidedAt ? fmtDateTime(profile.decidedAt) : "Not decided"}</dd>
                {profile.decidedBy && <><dt className="text-muted">Decided by</dt><dd className="m-0 break-words">{profile.decidedBy}</dd></>}
                {profile.decisionNote && <><dt className="text-muted">Decision note</dt><dd className="m-0 break-words">{profile.decisionNote}</dd></>}
              </dl>
              {profile.approvalStatus === "pending" && <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                <ActionForm action={decideMemberAccessAction} submit="Approve" className="grid gap-2">
                  <input type="hidden" name="userId" value={profile.userId} /><input type="hidden" name="decision" value="approve" />
                  <label className="grid gap-1"><span className="label">Decision note <span className="text-dim">optional</span></span><input className="input" name="note" maxLength={500} /></label>
                </ActionForm>
                <ActionForm action={decideMemberAccessAction} submit="Reject" variant="btn btn-ghost" className="grid gap-2">
                  <input type="hidden" name="userId" value={profile.userId} /><input type="hidden" name="decision" value="reject" />
                  <label className="grid gap-1"><span className="label">Decision note <span className="text-dim">optional</span></span><input className="input" name="note" maxLength={500} /></label>
                </ActionForm>
              </div>}
              {profile.approvalStatus === "approved" && <ActionForm action={decideMemberAccessAction} submit="Revoke access" variant="btn btn-ghost" className="grid gap-2 border-t border-line pt-4">
                <input type="hidden" name="userId" value={profile.userId} /><input type="hidden" name="decision" value="revoke" />
                <label className="grid gap-1"><span className="label">Decision note <span className="text-dim">optional</span></span><input className="input" name="note" maxLength={500} /></label>
              </ActionForm>}
              {(profile.approvalStatus === "rejected" || profile.approvalStatus === "revoked") && canApprove && <ActionForm action={decideMemberAccessAction} submit="Re-approve access" className="grid gap-2 border-t border-line pt-4">
                <input type="hidden" name="userId" value={profile.userId} /><input type="hidden" name="decision" value="reapprove" />
                <label className="grid gap-1"><span className="label">Decision note <span className="text-dim">optional</span></span><input className="input" name="note" maxLength={500} /></label>
              </ActionForm>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
