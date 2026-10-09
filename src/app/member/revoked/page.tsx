import { redirect } from "next/navigation";
import { getCurrentMember, isApprovedMember, memberStatusPath } from "@/lib/auth/member";
import { memberAuthConfigError } from "@/lib/supabase/config";
import { MemberStatus } from "../pending/page";

export const dynamic = "force-dynamic";

export default async function RevokedMemberPage() {
  if (memberAuthConfigError()) redirect("/member/sign-in");
  const member = await getCurrentMember();
  if (!member) redirect("/member/sign-in");
  if (isApprovedMember(member)) redirect("/sentiment");
  if (member.status === "approved") redirect("/member/pending");
  if (member.status !== "revoked") redirect(memberStatusPath(member.status));
  return <MemberStatus title="ACCESS REVOKED" message="Your access to the sentiment workspace has been revoked. Contact the site administrator if you believe this is an error." />;
}
