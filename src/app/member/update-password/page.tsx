import { redirect } from "next/navigation";
import { memberAuthConfigError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import UpdatePasswordForm from "../UpdatePasswordForm";

export const dynamic = "force-dynamic";

export default async function UpdatePasswordPage() {
  const problem = memberAuthConfigError();
  if (problem) return <main className="min-h-dvh grid place-items-center px-4"><p role="alert" className="panel p-6 text-amber">{problem}</p></main>;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/member/recovery?error=expired");
  return <main id="main" className="min-h-dvh grid place-items-center px-4"><section className="panel p-8 w-full max-w-md"><h1 className="font-pixel text-phosphor text-sm m-0 mb-2">CHOOSE A PASSWORD</h1><p className="text-muted text-sm m-0 mb-6">Choose a new password for your member account.</p><UpdatePasswordForm /></section></main>;
}
