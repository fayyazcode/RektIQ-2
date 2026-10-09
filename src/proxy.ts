import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

/**
 * Next 16's Proxy refreshes Supabase Auth cookies before Server Components read
 * them. It does not authorize application data; protected code calls the guard.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  try {
    const { url, anonKey } = getSupabasePublicConfig();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    await supabase.auth.getClaims();
  } catch {
    // Member pages render their explicit setup state when public Auth config is absent.
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|robots.txt).*)"],
};
