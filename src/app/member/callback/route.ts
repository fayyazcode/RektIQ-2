import { NextResponse } from "next/server";
import { getCurrentMember, isApprovedMember, memberStatusPath, safeMemberDestination } from "@/lib/auth/member";
import { memberAuthConfigError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const configProblem = memberAuthConfigError();
  if (configProblem) return NextResponse.redirect(new URL("/member/sign-in?error=setup", url));
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/member/sign-in?error=confirmation", url));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/member/sign-in?error=confirmation", url));
  if (url.searchParams.get("flow") === "recovery") {
    return NextResponse.redirect(new URL("/member/update-password", url));
  }
  const member = await getCurrentMember();
  if (!member) return NextResponse.redirect(new URL("/member/sign-in?error=confirmation", url));
  const destination = isApprovedMember(member)
    ? safeMemberDestination(url.searchParams.get("next"))
    : member.status === "approved" ? "/member/pending" : memberStatusPath(member.status);
  return NextResponse.redirect(new URL(destination, url));
}
