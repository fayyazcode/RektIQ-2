import { redirect } from "next/navigation";
import { getCurrentMember, isApprovedMember, memberStatusPath } from "@/lib/auth/member";
import { memberAuthConfigError } from "@/lib/supabase/config";
import { MemberStatus } from "../pending/page";

export const dynamic = "force-dynamic";

export default async function RejectedMemberPage() {
  if (memberAuthConfigError()) redirect("/member/sign-in");
  const member = await getCurrentMember();
  if (!member) redirect("/member/sign-in");
  if (isApprovedMember(member)) redirect("/sentiment");
  if (member.status === "approved") redirect("/member/pending");
  if (member.status !== "rejected") redirect(memberStatusPath(member.status));
  return <MemberStatus title="ACCESS NOT APPROVED" message="This access request was not approved. Contact the site administrator if you need more information." />;
}
