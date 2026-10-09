import Link from "next/link";
import { memberAuthConfigError } from "@/lib/supabase/config";
import PasswordResetRequestForm from "../PasswordResetRequestForm";

export const dynamic = "force-dynamic";

export default function RecoveryPage() {
  const problem = memberAuthConfigError();
  return <main id="main" className="min-h-dvh grid place-items-center px-4"><section className="panel p-8 w-full max-w-md"><h1 className="font-pixel text-phosphor text-sm m-0 mb-2">RESET PASSWORD</h1><p className="text-muted text-sm m-0 mb-6">Enter your email to receive a password-reset link.</p>{problem ? <p role="alert" className="text-amber text-sm m-0">{problem}</p> : <PasswordResetRequestForm />}<p className="text-sm text-muted mt-6 mb-0"><Link href="/member/sign-in">Return to sign in.</Link></p></section></main>;
}
