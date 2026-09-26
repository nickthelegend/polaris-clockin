import { DataError, type DashboardData } from "./source";
import type {
  ApiKey,
  AutoPayouts,
  CreatedApiKey,
  CreatedWebhookEndpoint,
  Merchant,
  Overview,
  Payment,
  PaymentLink,
  Payout,
  PayoutsState,
  Plan,
  WebhookDelivery,
  WebhooksState,
} from "./types";

type TokenSource = () => Promise<string | null>;

/**
 * `DashboardData` over our API routes.
 *
 * Every request carries the Privy access token as a Bearer token. The server
 * derives the merchant and their wallet from that token alone; nothing here
 * sends an address or an ID the server would have to trust.
 */
export function createHttpData(getAccessToken: TokenSource): DashboardData {
  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const token = await getAccessToken();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(path, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      throw new DataError("We couldn't reach Polaris. Check your connection and try again.", 0, "network");
    }

    const payload = (await res.json().catch(() => null)) as
      | { data?: T; error?: { code?: string; message?: string } }
      | null;

    if (!res.ok) {
      throw new DataError(
        payload?.error?.message ?? `The request failed (${res.status}).`,
        res.status,
        payload?.error?.code ?? "http_error",
      );
    }
    if (!payload || !("data" in payload)) {
      throw new DataError("The response was empty.", res.status, "empty");
    }
    return payload.data as T;
  }

  return {
    getMerchant: () => call<Merchant>("/api/me"),
    updateMerchant: (input) => call<Merchant>("/api/me", { method: "POST", body: input }),
    getOverview: () => call<Overview>("/api/overview"),
    listLinks: () => call<PaymentLink[]>("/api/links"),
    createLink: (input) => call<PaymentLink>("/api/links", { method: "POST", body: input }),
    listPayments: () => call<Payment[]>("/api/payments"),
    listPlans: () => call<Plan[]>("/api/plans"),
    getPayouts: () => call<PayoutsState>("/api/payouts"),
    withdraw: (input) => call<Payout>("/api/payouts", { method: "POST", body: input }),
    setAutoPayouts: (input) => call<AutoPayouts>("/api/payouts/automatic", { method: "POST", body: input }),
    listApiKeys: () => call<ApiKey[]>("/api/keys"),
    createApiKey: (input) => call<CreatedApiKey>("/api/keys", { method: "POST", body: input }),
    listWebhooks: () => call<WebhooksState>("/api/webhooks"),
    createWebhook: (input) => call<CreatedWebhookEndpoint>("/api/webhooks", { method: "POST", body: input }),
    sendTestEvent: (endpointId) =>
      call<WebhookDelivery>(`/api/webhooks/${encodeURIComponent(endpointId)}/test`, { method: "POST" }),
  };
}
