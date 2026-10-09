import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember, isApprovedMember, memberStatusPath, safeMemberDestination } from "@/lib/auth/member";
import { memberAuthConfigError } from "@/lib/supabase/config";
import { signInAction } from "../actions";
import MemberCredentialsForm from "../MemberCredentialsForm";

export const metadata: Metadata = { title: "Member sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MemberSignInPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams;
  const configProblem = memberAuthConfigError();
  if (!configProblem) {
    const member = await getCurrentMember();
    if (member) redirect(isApprovedMember(member) ? safeMemberDestination(next) : member.status === "approved" ? "/member/pending" : memberStatusPath(member.status));
  }
  return (
    <main id="main" className="min-h-dvh grid place-items-center px-4">
      <section className="panel p-8 w-full max-w-md">
        <h1 className="font-pixel text-phosphor text-sm m-0 mb-2">MEMBER ACCESS</h1>
        <p className="text-muted text-sm m-0 mb-6">Sign in to the protected social sentiment workspace.</p>
        {reset === "complete" && <p className="text-phosphor text-sm" role="status">Password updated. Sign in with your new password.</p>}
        {configProblem ? <p role="alert" className="text-amber text-sm m-0">{configProblem}</p> : <MemberCredentialsForm action={signInAction} mode="sign-in" next={safeMemberDestination(next)} />}
        <p className="text-sm text-muted mt-6 mb-0">Need access? <Link href="/member/sign-up">Request a member account.</Link> <Link href="/member/recovery">Forgot your password?</Link></p>
      </section>
    </main>
  );
}
