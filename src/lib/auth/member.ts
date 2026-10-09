import "server-only";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getPostgresDb } from "@/lib/db/client";
import { memberProfiles } from "@/lib/db/schema";
import { memberAuthConfigError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type MemberApprovalStatus = "pending" | "approved" | "rejected" | "revoked";
export type ApprovedMember = { userId: string; email: string | null };

export class MemberAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberAuthConfigurationError";
  }
}

export function safeMemberDestination(value: string | null | undefined) {
  return value === "/sentiment" ? value : "/sentiment";
}

export function memberStatusPath(status: Exclude<MemberApprovalStatus, "approved">) {
  return `/member/${status}`;
}

export function isApprovedMember(member: { status: MemberApprovalStatus; emailConfirmed: boolean }) {
  return member.status === "approved" && member.emailConfirmed;
}

export async function getCurrentMember() {
  const configProblem = memberAuthConfigError();
  if (configProblem) throw new MemberAuthConfigurationError(configProblem);
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const rows = await getPostgresDb()
    .select({ status: memberProfiles.approvalStatus })
    .from(memberProfiles)
    .where(eq(memberProfiles.userId, user.id))
    .limit(1);
  return {
    user,
    status: rows[0]?.status ?? ("pending" as MemberApprovalStatus),
    emailConfirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at),
  };
}

/** Enforces a fresh Auth identity and application approval lookup for every request. */
export async function requireApprovedMember(next = "/sentiment"): Promise<ApprovedMember> {
  const member = await getCurrentMember();
  if (!member) redirect(`/member/sign-in?next=${encodeURIComponent(safeMemberDestination(next))}`);
  if (!isApprovedMember(member)) redirect(member.status === "approved" ? "/member/pending" : memberStatusPath(member.status));
  return { userId: member.user.id, email: member.user.email ?? null };
}
