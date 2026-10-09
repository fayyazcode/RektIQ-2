"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="grid gap-1">
        <span className="label">Username</span>
        <input className="input" name="username" autoComplete="username" required />
      </label>
      <label className="grid gap-1">
        <span className="label">Password</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      {state?.error && <p role="alert" className="text-danger text-sm m-0">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
