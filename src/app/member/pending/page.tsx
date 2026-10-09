import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember, isApprovedMember, memberStatusPath } from "@/lib/auth/member";
import { memberAuthConfigError } from "@/lib/supabase/config";
import { signOutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PendingMemberPage() {
  const problem = memberAuthConfigError();
  if (problem) return <main className="min-h-dvh grid place-items-center px-4"><p role="alert" className="panel p-6 text-amber">{problem}</p></main>;
  const member = await getCurrentMember();
  if (!member) redirect("/member/sign-in");
  if (isApprovedMember(member)) redirect("/sentiment");
  if (member.status !== "pending" && member.status !== "approved") redirect(memberStatusPath(member.status));
  return <MemberStatus title="REQUEST RECEIVED" message="Your email is confirmed. An administrator must approve your access before the sentiment workspace is available." />;
}

export function MemberStatus({ title, message }: { title: string; message: string }) {
  return <main id="main" className="min-h-dvh grid place-items-center px-4"><section className="panel p-8 w-full max-w-md"><h1 className="font-pixel text-phosphor text-sm m-0 mb-4">{title}</h1><p className="text-muted text-sm m-0 mb-6">{message}</p><div className="flex flex-wrap gap-3"><Link className="btn btn-ghost" href="/member/sign-in">Check status</Link><form action={signOutAction}><button className="btn btn-ghost">Sign out</button></form></div></section></main>;
}
