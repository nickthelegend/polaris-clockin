/**
 * Whether this build may contain the dev mock of the Polaris API.
 *
 * next.config.ts sets HALCYON_DEV_MOCK to "1" for `next dev` and "0" for
 * `next build`, and Next inlines `process.env.HALCYON_DEV_MOCK` at build
 * time. So a production bundle holds the literal "0" here: the mock branch
 * is dead code there, whatever NODE_ENV says when the server starts.
 */
export function devMockBuild(): boolean {
  return process.env.HALCYON_DEV_MOCK === "1";
}

/**
 * The dev mock of the Polaris API answers only in a development build, only
 * under NODE_ENV=development, and only while POLARIS_API_BASE is unset (so it
 * can never shadow a real backend). In a production build its routes don't
 * exist at all: they are `*.dev.ts` files, which next.config.ts only compiles
 * for the development server.
 */
export function devMockEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return devMockBuild() && env.NODE_ENV === "development" && !env.POLARIS_API_BASE?.trim();
}

export function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

// The mock's secrets and origin live in polaris.ts, behind the same inlined
// flag, so a production build compiles them down to a throw.
export { devMockInternalOrigin, devMockSecrets, type DevMockSecrets } from "@/lib/polaris";
