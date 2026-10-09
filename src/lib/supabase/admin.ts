import "server-only";

import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth/session";
import { secret } from "@/lib/env";
import { getSupabasePublicConfig } from "./config";

export type AdminAuthUser = {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
};

function createSupabaseAdminClient() {
  const { url } = getSupabasePublicConfig();
  const serviceRoleKey = secret("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the admin Access queue.");
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function toAdminAuthUser(user: { id: string; email?: string; email_confirmed_at?: string | null; confirmed_at?: string | null }): AdminAuthUser {
  return {
    id: user.id,
    email: user.email ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at),
  };
}

/** Uses the service role only after independently verifying the bootstrap admin session. */
export async function getAdminAuthUser(userId: string): Promise<AdminAuthUser | null> {
  await requireAdmin();
  const { data, error } = await createSupabaseAdminClient().auth.admin.getUserById(userId);
  if (error) throw new Error(`Unable to read member confirmation status: ${error.message}`);
  return data.user ? toAdminAuthUser(data.user) : null;
}

/** Returns all Auth identities for the Access queue without exposing the client to browser code. */
export async function getAdminAuthUsers(): Promise<Map<string, AdminAuthUser>> {
  await requireAdmin();
  const supabase = createSupabaseAdminClient();
  const users = new Map<string, AdminAuthUser>();
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Unable to load member email addresses: ${error.message}`);
    for (const user of data.users) users.set(user.id, toAdminAuthUser(user));
    if (data.users.length < perPage) return users;
  }
}
