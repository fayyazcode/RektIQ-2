import type { Instrumentation } from "next";

/** Initialize the PostgreSQL client once per Node.js server process. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warmDb } = await import("./lib/db");
    warmDb();
  }
}

function errorDetails(error: unknown) {
  const details: { name?: string; digest?: string; code?: string }[] = [];
  let current: unknown = error;

  for (let depth = 0; current && depth < 4; depth++) {
    if (typeof current !== "object") break;
    const value = current as { name?: unknown; digest?: unknown; code?: unknown; cause?: unknown };
    details.push({
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...(typeof value.digest === "string" ? { digest: value.digest } : {}),
      ...(typeof value.code === "string" ? { code: value.code } : {}),
    });
    current = value.cause;
  }

  return details;
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const path = request.path.split("?", 1)[0];
  if (!path.startsWith("/admin")) return;

  console.error("[admin-request-error]", JSON.stringify({
    path,
    method: request.method,
    route: context.routePath,
    type: context.routeType,
    renderSource: context.renderSource,
    errors: errorDetails(error),
  }));
};
