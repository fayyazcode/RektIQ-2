import ActionForm from "@/app/admin/ActionForm";
import { createTrackedAccountAction, setTrackedAccountActiveAction, updateTrackedAccountAction } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/auth/session";
import { getPostgresDb } from "@/lib/db/client";
import { trackedAccountGroups, trackedAccounts } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const GROUPS = ["majors", "onchain", "momentum"] as const;

function GroupFields({ selected = [] }: { selected?: readonly string[] }) {
  return <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-2 border-0 p-0"><legend className="label mb-1">Groups</legend>{GROUPS.map((group) => <label key={group} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" name="groups" value={group} defaultChecked={selected.includes(group)} />{group}</label>)}</fieldset>;
}

export default async function ProfilesPage() {
  await requireAdmin();
  const [accounts, memberships] = await Promise.all([
    getPostgresDb().select().from(trackedAccounts).orderBy(trackedAccounts.normalizedHandle),
    getPostgresDb().select().from(trackedAccountGroups),
  ]);
  const groupsByAccount = new Map<string, string[]>();
  for (const membership of memberships) groupsByAccount.set(membership.accountId, [...(groupsByAccount.get(membership.accountId) ?? []), membership.groupKey]);

  return (
    <div className="grid gap-6">
      <div><h1 className="m-0 font-mono text-2xl">X Profiles</h1><p className="m-0 mt-2 max-w-[70ch] text-sm text-muted">Tracked profiles can belong to multiple groups. Deactivation stops collection while retaining existing post and signal references.</p></div>
      <section className="panel grid gap-4 p-4 sm:p-5"><div><h2 className="m-0 font-mono text-lg">Add profile</h2><p className="m-0 mt-1 text-xs text-muted">Enter @handle, handle, https://x.com/handle, or https://twitter.com/handle.</p></div>
        <ActionForm action={createTrackedAccountAction} submit="Add profile" className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1"><span className="label">X handle or profile URL</span><input className="input" name="handle" required maxLength={512} /></label><label className="grid gap-1"><span className="label">Display name <span className="text-dim">optional</span></span><input className="input" name="displayName" maxLength={100} /></label></div><GroupFields />
        </ActionForm>
      </section>
      {!accounts.length && <p className="panel m-0 p-5 text-sm text-muted">No profiles are tracked yet.</p>}
      <ul className="m-0 grid list-none gap-4 p-0 xl:grid-cols-2">{accounts.map((account) => {
        const groups = groupsByAccount.get(account.id) ?? [];
        return <li key={account.id} className="panel grid min-w-0 gap-4 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="m-0 font-mono text-lg">@{account.handle}</h2>{account.displayName && <p className="m-0 mt-1 text-sm text-muted">{account.displayName}</p>}</div><span className={`chip ${account.active ? "text-phosphor" : "text-muted"}`}>{account.active ? "Active" : "Inactive"}</span></div>
          <details><summary className="cursor-pointer text-sm font-semibold">Edit profile</summary><ActionForm action={updateTrackedAccountAction} submit="Save profile" className="mt-3 grid gap-3"><input type="hidden" name="accountId" value={account.id} /><label className="grid gap-1"><span className="label">X handle or profile URL</span><input className="input" name="handle" defaultValue={`@${account.handle}`} required maxLength={512} /></label><label className="grid gap-1"><span className="label">Display name <span className="text-dim">optional</span></span><input className="input" name="displayName" defaultValue={account.displayName ?? ""} maxLength={100} /></label><GroupFields selected={groups} /></ActionForm></details>
          <ActionForm action={setTrackedAccountActiveAction} submit={account.active ? "Deactivate" : "Re-enable"} variant="btn btn-ghost" className="border-t border-line pt-4"><input type="hidden" name="accountId" value={account.id} /><input type="hidden" name="active" value={account.active ? "false" : "true"} /></ActionForm>
        </li>;
      })}</ul>
    </div>
  );
}
