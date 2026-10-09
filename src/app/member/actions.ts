"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getPostgresDb } from "@/lib/db/client";
import { memberProfiles } from "@/lib/db/schema";
import { getCurrentMember, isApprovedMember, memberStatusPath, safeMemberDestination } from "@/lib/auth/member";
import { memberAuthConfigError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type MemberActionState = { error?: string; message?: string } | null;

const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(320),
  password: z.string().min(12, "Use a password with at least 12 characters.").max(128)
    .regex(/[a-z]/, "Use at least one lowercase letter.")
    .regex(/[A-Z]/, "Use at least one uppercase letter.")
    .regex(/\d/, "Use at least one number.")
    .regex(/[^A-Za-z0-9]/, "Use at least one symbol."),
});
const passwordSchema = credentialsSchema.shape.password;
const emailSchema = credentialsSchema.shape.email;
const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(128),
});

function setupError(): MemberActionState | null {
  const problem = memberAuthConfigError();
  return problem ? { error: problem } : null;
}

function postgresFailure(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    if (typeof current !== "object") break;
    const value = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof value.code === "string") {
      return {
        code: value.code,
        ...(typeof value.constraint === "string" ? { constraint: value.constraint } : {}),
      };
    }
    current = value.cause;
  }
  return {};
}

function callbackUrl(flow: "confirmation" | "recovery") {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  try {
    const url = new URL(base || "https://rektoiq.vercel.app");
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid protocol");
    return new URL(`/member/callback?flow=${flow}`, url).toString();
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTP(S) URL before email confirmation can be requested.");
  }
}

export async function signUpAction(_: MemberActionState, form: FormData): Promise<MemberActionState> {
  const setup = setupError();
  if (setup) return setup;
  const parsed = credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the information and try again." };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { emailRedirectTo: callbackUrl("confirmation") },
    });
    if (error) return { error: error.message };
    if (data.user) {
      try {
        await getPostgresDb().insert(memberProfiles).values({ userId: data.user.id }).onConflictDoNothing();
      } catch (error) {
        const failure = postgresFailure(error);
        console.error("[member-sign-up-profile-insert]", JSON.stringify(failure));
        if (failure.code === "23503") {
          return { error: "Your account was created, but its access request could not be saved. Check that the Supabase Auth and database settings in Vercel point to the same project." };
        }
        if (failure.code === "42501") {
          return { error: "Your account was created, but the database connection cannot save access requests. Check the DATABASE_URL role permissions." };
        }
        if (failure.code === "42P01") {
          return { error: "Your account was created, but the member access table is missing. Apply the database schema migration, then try again." };
        }
        return { error: "Your account was created, but its access request could not be saved. Check the Vercel function logs and contact the site administrator." };
      }
    }
    return { message: "Check your email for a confirmation link. After confirmation, your access request will wait for approval." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to request member access right now." };
  }
}

export async function signInAction(_: MemberActionState, form: FormData): Promise<MemberActionState> {
  const setup = setupError();
  if (setup) return setup;
  const parsed = signInSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the information and try again." };
  const next = safeMemberDestination(String(form.get("next") ?? ""));

  let member: Awaited<ReturnType<typeof getCurrentMember>>;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return { error: "Email or password is incorrect, or the email has not been confirmed." };
    member = await getCurrentMember();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to sign in right now." };
  }
  if (!member) return { error: "Your sign-in session could not be verified. Please try again." };
  redirect(isApprovedMember(member) ? next : member.status === "approved" ? "/member/pending" : memberStatusPath(member.status));
}

export async function signOutAction() {
  const setup = setupError();
  if (setup) redirect("/member/sign-in");
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/member/sign-in");
}

/** Always returns the same success text so the endpoint cannot reveal account membership. */
export async function requestPasswordResetAction(_: MemberActionState, form: FormData): Promise<MemberActionState> {
  const setup = setupError();
  if (setup) return setup;
  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  const message = "If an account exists for that email, a password-reset link has been sent.";
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: callbackUrl("recovery") });
  } catch {
    // Keep the response generic for both unknown addresses and provider failures.
  }
  return { message };
}

export async function updatePasswordAction(_: MemberActionState, form: FormData): Promise<MemberActionState> {
  const setup = setupError();
  if (setup) return setup;
  const parsed = passwordSchema.safeParse(form.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose a stronger password." };
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { error: "This password-reset link has expired. Request a new one." };
    const { error } = await supabase.auth.updateUser({ password: parsed.data });
    if (error) return { error: "Unable to update the password. Request a new reset link and try again." };
    await supabase.auth.signOut();
  } catch {
    return { error: "Unable to update the password. Request a new reset link and try again." };
  }
  redirect("/member/sign-in?reset=complete");
}
