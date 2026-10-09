export type SupabasePublicConfig = { url: string; anonKey: string };

const publicUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const publicAnonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";

/** Returns a user-facing setup message without ever reading server credentials. */
export function memberAuthConfigError(): string | null {
  const url = publicUrl();
  const anonKey = publicAnonKey();
  if (!url) return "Member sign-in is not configured. Set NEXT_PUBLIC_SUPABASE_URL.";
  if (!anonKey) return "Member sign-in is not configured. Set NEXT_PUBLIC_SUPABASE_ANON_KEY.";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("invalid protocol");
  } catch {
    return "Member sign-in is not configured. NEXT_PUBLIC_SUPABASE_URL must be an HTTP(S) URL.";
  }
  return null;
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const problem = memberAuthConfigError();
  if (problem) throw new Error(problem);
  return {
    url: publicUrl(),
    anonKey: publicAnonKey(),
  };
}
