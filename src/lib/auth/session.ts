import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasSecret, secret as readSecret } from "../env";

const COOKIE = "cg_session";
const TTL_SECONDS = 12 * 60 * 60;

/** Null when SESSION_SECRET is missing or too short; admin login then explains what to set. */
export function sessionConfigError(): string | null {
  const s = readSecret("SESSION_SECRET");
  if (!s) return "SESSION_SECRET is not set. Add a random value of at least 32 characters (openssl rand -base64 48).";
  if (s.length < 32) return `SESSION_SECRET is ${s.length} characters long; it needs at least 32.`;
  if (!hasSecret("ADMIN_PASSWORD_HASH")) return "ADMIN_PASSWORD_HASH is not set. Run npm run hash-password -- \"your-password\" and add the output.";
  return null;
}

function secret() {
  const problem = sessionConfigError();
  if (problem) throw new Error(problem);
  return new TextEncoder().encode(readSecret("SESSION_SECRET")!);
}

export async function createSession(username: string) {
  const token = await new SignJWT({ sub: username, role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<{ username: string } | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || sessionConfigError()) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.role === "admin" && typeof payload.sub === "string" ? { username: payload.sub } : null;
  } catch {
    return null;
  }
}

/** Call at the top of every admin page, server action and admin route handler. */
export async function requireAdmin(next?: string): Promise<{ username: string }> {
  const s = await getSession();
  if (!s) redirect(`/admin/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return s;
}
