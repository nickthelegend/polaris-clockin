import type {
  ApiKey,
  AutoPayouts,
  AutoPayoutsInput,
  CreateApiKeyInput,
  CreatedApiKey,
  CreatedWebhookEndpoint,
  CreateLinkInput,
  CreateWebhookInput,
  Merchant,
  Overview,
  Payment,
  PaymentLink,
  PayoutsState,
  Plan,
  WebhookDelivery,
  UpdateWebhookInput,
  WebhookEndpoint,
  WebhooksState,
  WithdrawInput,
  Payout,
} from "./types";

/**
 * Everything the dashboard reads or writes, as one interface.
 *
 * Pages depend on this and nothing else. It is implemented over our own
 * authenticated API routes (`http.ts`); the sample implementation
 * (`sample.ts`) serves the labelled "Preview with sample data" view and the
 * development-only mock session. When the indexer and a database land, only
 * the server side changes; the pages don't.
 */
export interface DashboardData {
  getMerchant(): Promise<Merchant>;
  updateMerchant(input: { businessName: string }): Promise<Merchant>;

  getOverview(): Promise<Overview>;

  listLinks(): Promise<PaymentLink[]>;
  createLink(input: CreateLinkInput): Promise<PaymentLink>;
  /** Turn a link off. Links are never deleted. */
  deactivateLink(linkId: string): Promise<PaymentLink>;

  listPayments(): Promise<Payment[]>;
  listPlans(): Promise<Plan[]>;

  getPayouts(): Promise<PayoutsState>;
  withdraw(input: WithdrawInput): Promise<Payout>;
  setAutoPayouts(input: AutoPayoutsInput): Promise<AutoPayouts>;

  listApiKeys(): Promise<ApiKey[]>;
  createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey>;
  revokeApiKey(keyId: string): Promise<{ id: string; revoked: true }>;

  listWebhooks(): Promise<WebhooksState>;
  createWebhook(input: CreateWebhookInput): Promise<CreatedWebhookEndpoint>;
  updateWebhook(endpointId: string, input: UpdateWebhookInput): Promise<WebhookEndpoint>;
  deleteWebhook(endpointId: string): Promise<{ id: string; deleted: true }>;
  sendTestEvent(endpointId: string): Promise<WebhookDelivery>;
}

/** An error the API returned on purpose, with a message fit to show a person. */
export class DataError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    /** The request field a validation error is about, to mark in a form. */
    readonly field?: string,
  ) {
    super(message);
    this.name = "DataError";
  }
}

/** A session that is over: sign the person out and send them to sign in. */
export function isSessionEnded(error: unknown): boolean {
  return error instanceof DataError && error.status === 401 && (error.code === "unauthenticated" || error.code === "invalid_token");
}

/** The message to show for anything a data call threw. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  if (error instanceof DataError) {
    if (error.code === "auth_not_configured") return "Sign-in isn't configured on this server yet, so your data can't load.";
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
