import { randomBytes } from "node:crypto";

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

export interface DevMockSecrets {
  /** The only key the mock API accepts, and the only one the shop sends it. */
  secretKey: string;
  /** What the mock signs its webhooks with, and the only secret the shop verifies them with in mock mode. */
  webhookSecret: string;
}

const holder = globalThis as unknown as { __halcyonDevMockSecrets?: DevMockSecrets };

/**
 * Fresh random secrets for this dev server process, shared by the shop and
 * its mock through globalThis (route handlers run in one process in `next
 * dev`). Nothing about them is in the repository, so knowing the source
 * doesn't let anyone sign a webhook the shop will accept. They change on
 * every restart, which the mock doesn't mind: it keeps no signed state.
 */
export function devMockSecrets(): DevMockSecrets {
  holder.__halcyonDevMockSecrets ??= {
    // Letters and digits after the prefix: the SDK refuses anything else in a key.
    secretKey: `sk_test_${randomBytes(16).toString("hex")}`,
    webhookSecret: `whsec_${randomBytes(24).toString("hex")}`,
  };
  return holder.__halcyonDevMockSecrets;
}

/**
 * Where the shop's server reaches its own mock: a fixed local origin, never
 * one taken from a request's Host or X-Forwarded-Host (which would let a
 * caller point the shop's bearer key at a server of their choosing).
 */
export function devMockInternalOrigin(env: Record<string, string | undefined> = process.env): string {
  const port = /^\d{2,5}$/.test(env.PORT ?? "") ? env.PORT : "3600";
  return `http://127.0.0.1:${port}`;
}
