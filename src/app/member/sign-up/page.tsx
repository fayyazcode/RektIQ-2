import type { Metadata } from "next";
import Link from "next/link";
import { memberAuthConfigError } from "@/lib/supabase/config";
import { signUpAction } from "../actions";
import MemberCredentialsForm from "../MemberCredentialsForm";

export const metadata: Metadata = { title: "Request member access", robots: { index: false, follow: false } };

export default function MemberSignUpPage() {
  const configProblem = memberAuthConfigError();
  return (
    <main id="main" className="min-h-dvh grid place-items-center px-4">
      <section className="panel p-8 w-full max-w-md">
        <h1 className="font-pixel text-phosphor text-sm m-0 mb-2">REQUEST ACCESS</h1>
        <p className="text-muted text-sm m-0 mb-6">Confirm your email, then wait for an administrator to approve your request.</p>
        {configProblem ? <p role="alert" className="text-amber text-sm m-0">{configProblem}</p> : <MemberCredentialsForm action={signUpAction} mode="sign-up" />}
        <p className="text-sm text-muted mt-6 mb-0">Already have an account? <Link href="/member/sign-in">Sign in.</Link></p>
      </section>
    </main>
  );
}
