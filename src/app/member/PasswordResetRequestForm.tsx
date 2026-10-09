"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type MemberActionState } from "./actions";

export default function PasswordResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, null as MemberActionState);
  return <form action={action} className="grid gap-4" aria-describedby="reset-request-status">
    <label className="grid gap-1"><span className="label">Email</span><input className="input" name="email" type="email" autoComplete="email" required /></label>
    <div id="reset-request-status" aria-live="polite">
      {state?.error && <p role="alert" className="text-danger text-sm m-0">{state.error}</p>}
      {state?.message && <p className="text-phosphor text-sm m-0">{state.message}</p>}
    </div>
    <button className="btn" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
  </form>;
}
