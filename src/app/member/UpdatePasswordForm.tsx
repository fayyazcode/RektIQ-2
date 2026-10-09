"use client";

import { useActionState } from "react";
import { updatePasswordAction, type MemberActionState } from "./actions";

export default function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, null as MemberActionState);
  return <form action={action} className="grid gap-4" aria-describedby="update-password-status">
    <label className="grid gap-1"><span className="label">New password</span><input className="input" name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
    <p className="text-xs text-muted m-0">Use 12 or more characters with lowercase and uppercase letters, a number, and a symbol.</p>
    <div id="update-password-status" aria-live="polite">{state?.error && <p role="alert" className="text-danger text-sm m-0">{state.error}</p>}</div>
    <button className="btn" disabled={pending}>{pending ? "Updating…" : "Update password"}</button>
  </form>;
}
