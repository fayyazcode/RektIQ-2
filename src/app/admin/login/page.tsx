import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, sessionConfigError } from "@/lib/auth/session";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getSession()) redirect(next?.startsWith("/admin") ? next : "/admin");
  return (
    <main id="main" className="min-h-dvh grid place-items-center px-4">
      <div className="panel p-8 w-full max-w-sm">
        <h1 className="font-pixel text-phosphor text-sm m-0 mb-2">ADMIN</h1>
        <p className="text-muted text-sm m-0 mb-6">Sign in to manage the post queue and automation.</p>
        {sessionConfigError() ? (
          <p role="alert" className="text-amber text-sm m-0">Admin sign-in isn&apos;t set up: {sessionConfigError()}</p>
        ) : (
          <LoginForm next={next ?? "/admin"} />
        )}
      </div>
    </main>
  );
}
