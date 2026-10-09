"use client";

import { useActionState } from "react";
import type { MemberActionState } from "./actions";

export default function MemberCredentialsForm({
  action,
  mode,
  next,
}: {
  action: (state: MemberActionState, form: FormData) => Promise<MemberActionState>;
  mode: "sign-in" | "sign-up";
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const signUp = mode === "sign-up";
  return (
    <form action={formAction} className="grid gap-4" aria-describedby="member-form-status">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="grid gap-1">
        <span className="label">Email</span>
        <input className="input" name="email" type="email" autoComplete="email" required />
      </label>
      <label className="grid gap-1">
        <span className="label">Password</span>
        <input className="input" name="password" type="password" autoComplete={signUp ? "new-password" : "current-password"} minLength={12} required />
      </label>
      <p className="text-xs text-muted m-0">Passwords must contain at least 12 characters.</p>
      <div id="member-form-status" aria-live="polite">
        {state?.error && <p role="alert" className="text-danger text-sm m-0">{state.error}</p>}
        {state?.message && <p className="text-phosphor text-sm m-0">{state.message}</p>}
      </div>
      <button className="btn" disabled={pending}>{pending ? "Working…" : signUp ? "Request access" : "Sign in"}</button>
    </form>
  );
}
