/**
 * CRE's HTTP capability, answered from @polarispay/underwriting's fixtures
 * (synthesized in each provider's documented shape; see
 * packages/underwriting/fixtures/README.md). No network, no keys.
 *
 * It also records what the workflow sent, so tests can check that keys ride
 * in headers (Etherscan: its query parameter), never elsewhere, and that
 * every call asked CRE to cache the response.
 */

import { join } from "node:path";
import { DEFAULT_FIXTURES_DIR, fixtureResponse } from "@polarispay/underwriting";
import { fs, os } from "./host.ts";

export interface SentRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  cached: boolean;
}

/** The Request message the HTTP mock receives, reduced to what we read. */
export interface CreRequestLike {
  url: string;
  method: string;
  body: Uint8Array;
  multiHeaders: Record<string, { values: string[] }>;
  cacheSettings?: { store?: boolean };
}

export function toSent(input: CreRequestLike): SentRequest {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.multiHeaders ?? {})) headers[k.toLowerCase()] = v.values[0] ?? "";
  const body = input.body && input.body.length > 0 ? new TextDecoder().decode(input.body) : undefined;
  return { url: input.url, method: input.method, headers, body, cached: input.cacheSettings?.store === true };
}

/** Answer one provider request from the fixtures, the way the provider would. */
export function answerFromFixtures(sent: SentRequest, dir: string = DEFAULT_FIXTURES_DIR) {
  // The fixture transport never sees keys: strip Etherscan's before routing.
  const url = sent.url.replace(/&apikey=[^&]*/, "");
  try {
    const res = fixtureResponse({ method: sent.method as "GET" | "POST", url, headers: sent.headers, body: sent.body }, dir);
    return {
      statusCode: res.status,
      body: Buffer.from(res.body, "utf8").toString("base64"),
      multiHeaders: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, { values: [v] }])),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { statusCode: 404, body: Buffer.from(JSON.stringify({ error: message })).toString("base64") };
  }
}

/**
 * A copy of the fixtures where `to` has `from`'s history, so a test can sign
 * with a key it holds (the fixture personas' addresses are synthetic and have
 * none). Only files named for `from` are cloned, with the address replaced.
 */
export function cloneFixtures(pairs: Array<{ from: string; to: string }>): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "polaris-cre-fixtures-"));
  fs.cpSync(DEFAULT_FIXTURES_DIR, dir, { recursive: true });
  const walk = (d: string): string[] =>
    fs.readdirSync(d).flatMap((n: string) => {
      const p = join(d, n);
      return fs.statSync(p).isDirectory() ? walk(p) : [p];
    });
  for (const file of walk(dir)) {
    for (const { from, to } of pairs) {
      const f = from.toLowerCase();
      const name = file.split(/[\\/]/).pop()!;
      if (!name.toLowerCase().startsWith(f)) continue;
      const target = file.slice(0, file.length - name.length) + to.toLowerCase() + name.slice(f.length);
      const text = fs.readFileSync(file, "utf8").replace(new RegExp(f, "gi"), to.toLowerCase());
      if (!fs.existsSync(target)) fs.writeFileSync(target, text);
    }
  }
  return dir;
}

/** The ConfidentialHTTPRequest message the Confidential HTTP mock receives, reduced to what we read. */
export interface ConfidentialRequestLike {
  vaultDonSecrets: Array<{ key: string }>;
  request?: {
    url: string;
    method: string;
    body?: { case?: string; value?: unknown };
    multiHeaders: Record<string, { values: string[] }>;
    encryptOutput?: boolean;
  };
}

export interface ConfidentialSent {
  /** The request as the workflow built it: placeholders, never a key. */
  built: SentRequest;
  /** The secret ids it asked the enclave for. */
  secretKeys: string[];
  /** The request as the enclave sends it, placeholders resolved. */
  resolved: SentRequest;
}

/**
 * Resolve `{{.KEY}}` placeholders the way the enclave does (in headers and a
 * body; chainlink's simulator uses Go's text/template the same way), with the
 * stricter rule a real enclave has: only the secrets the request lists.
 */
export function toSentConfidential(input: ConfidentialRequestLike, values: Record<string, string>): ConfidentialSent {
  const r = input.request;
  if (!r) throw new Error("confidential request without a request");
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.multiHeaders ?? {})) headers[k.toLowerCase()] = v.values[0] ?? "";
  const body = r.body?.case === "bodyString" ? String(r.body.value) : undefined;
  const built: SentRequest = { url: r.url, method: r.method, headers, body, cached: false };
  const secretKeys = input.vaultDonSecrets.map((s) => s.key);
  const resolve = (text: string) =>
    text.replace(/\{\{\s*\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, key: string) => {
      if (!secretKeys.includes(key)) throw new Error(`placeholder {{.${key}}} names a secret the request did not list`);
      const v = values[key];
      if (v === undefined) throw new Error(`no value for secret ${key}`);
      return v;
    });
  const resolved: SentRequest = {
    url: r.url,
    method: r.method,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, resolve(v)])),
    body: body === undefined ? undefined : resolve(body),
    cached: false,
  };
  return { built, secretKeys, resolved };
}

/**
 * Answer one Confidential HTTP request from the fixtures. Etherscan's key
 * arrives as a POST form body (its GET API takes it only in the query
 * string); Etherscan reads request parameters from either, so the fixture
 * transport answers it as the GET it stands for.
 */
export function answerConfidentialFromFixtures(sent: ConfidentialSent, dir: string = DEFAULT_FIXTURES_DIR) {
  const r = sent.resolved;
  if (r.url.startsWith("https://api.etherscan.io") && r.method === "POST" && /^apikey=[^&]*$/.test(r.body ?? "")) {
    return answerFromFixtures({ ...r, method: "GET", body: undefined }, dir);
  }
  return answerFromFixtures(r, dir);
}
