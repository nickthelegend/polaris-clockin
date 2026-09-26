/**
 * The dev mock of the Polaris API answers only in `next dev`, and only while
 * POLARIS_API_BASE is unset (so it can never shadow a real backend). In a
 * production build its routes don't exist at all: they are `*.dev.ts` files,
 * which next.config.ts only compiles for the development server.
 */
export function devMockEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "development" && !env.POLARIS_API_BASE?.trim();
}

export function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
