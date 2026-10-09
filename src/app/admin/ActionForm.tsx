"use client";

import { useActionState } from "react";
import type { ActionState } from "./actions";

/** Small wrapper so every admin form shows its result inline. */
export default function ActionForm({
  action,
  children,
  submit,
  className,
  variant = "btn",
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children?: React.ReactNode;
  submit: string;
  className?: string;
  variant?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className={variant} disabled={pending}>{pending ? "Working…" : submit}</button>
        {state?.ok && <span role="status" className="text-phosphor text-sm">{state.ok}</span>}
        {state?.error && <span role="alert" className="text-danger text-sm">{state.error}</span>}
      </div>
    </form>
  );
}
