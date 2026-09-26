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
  WebhooksState,
  WithdrawInput,
  Payout,
} from "./types";

/**
 * Everything the dashboard reads or writes, as one interface.
 *
 * Pages depend on this and nothing else. Today it is implemented over our own
 * authenticated API routes (`http.ts`), which serve placeholder data from the
 * in-memory server store. When the indexer and a database land, only the server
 * side changes; the pages don't.
 */
export interface DashboardData {
  getMerchant(): Promise<Merchant>;
  updateMerchant(input: { businessName: string }): Promise<Merchant>;

  getOverview(): Promise<Overview>;

  listLinks(): Promise<PaymentLink[]>;
  createLink(input: CreateLinkInput): Promise<PaymentLink>;

  listPayments(): Promise<Payment[]>;
  listPlans(): Promise<Plan[]>;

  getPayouts(): Promise<PayoutsState>;
  withdraw(input: WithdrawInput): Promise<Payout>;
  setAutoPayouts(input: AutoPayoutsInput): Promise<AutoPayouts>;

  listApiKeys(): Promise<ApiKey[]>;
  createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey>;

  listWebhooks(): Promise<WebhooksState>;
  createWebhook(input: CreateWebhookInput): Promise<CreatedWebhookEndpoint>;
  sendTestEvent(endpointId: string): Promise<WebhookDelivery>;
}

/** An error the API returned on purpose, with a message fit to show a person. */
export class DataError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "DataError";
  }
}
