import "server-only";

import { seedMerchantBook } from "@/lib/data/placeholder";
import type {
  Address,
  ApiKey,
  AutoPayouts,
  Cents,
  CollectorStatus,
  Merchant,
  Payment,
  PaymentLink,
  Payout,
  Plan,
  WebhookDelivery,
  WebhookEndpoint,
} from "@/lib/data/types";

/**
 * The merchant store.
 *
 * Route handlers talk to this interface and nothing else. Today it is an
 * in-memory map, per server instance: it forgets everything on a restart, so
 * the dashboard never calls what it holds permanent. New merchants start
 * empty; only with NEXT_PUBLIC_POLARIS_DEMO_DATA=1 are they seeded with a
 * labelled sample book. A later step swaps in a database-backed
 * implementation of the same interface (and the indexer feeds payments, plans
 * and the collector status). Every method is async so that swap changes no
 * call site.
 *
 * Secrets never leave the store through the API layer: `StoredApiKey` carries
 * only a hash of the secret key, and a webhook's signing secret stays here.
 */

export type StoredApiKey = ApiKey & {
  /** SHA-256 (peppered) of the secret key. The secret itself is never stored. */
  secretHash: string;
};

export type StoredWebhook = WebhookEndpoint & {
  /** The HMAC signing secret. Needed to sign deliveries, so it is kept, never returned. */
  secret: string;
};

export type Identity = {
  id: string;
  walletAddress: Address | null;
  email: string | null;
};

export interface MerchantStore {
  /** Return the merchant, creating (and, for now, seeding) them on first sight. */
  ensureMerchant(identity: Identity): Promise<Merchant>;
  updateMerchant(id: string, patch: { businessName?: string }): Promise<Merchant>;

  listLinks(merchantId: string): Promise<PaymentLink[]>;
  insertLink(merchantId: string, link: PaymentLink): Promise<PaymentLink>;
  /** Change a link's status (turning it off). Null when it isn't this merchant's. */
  updateLink(merchantId: string, linkId: string, patch: { status: PaymentLink["status"] }): Promise<PaymentLink | null>;

  listPayments(merchantId: string): Promise<Payment[]>;
  listPlans(merchantId: string): Promise<Plan[]>;
  getCollector(merchantId: string): Promise<CollectorStatus>;

  getBalance(merchantId: string): Promise<Cents>;
  listPayouts(merchantId: string): Promise<Payout[]>;
  /** Debit the balance and record the payout in one step. Throws `InsufficientBalance`. */
  recordPayout(merchantId: string, payout: Payout): Promise<Payout>;
  getAutoPayouts(merchantId: string): Promise<AutoPayouts>;
  setAutoPayouts(merchantId: string, auto: AutoPayouts): Promise<AutoPayouts>;

  listApiKeys(merchantId: string): Promise<StoredApiKey[]>;
  insertApiKey(merchantId: string, key: StoredApiKey): Promise<StoredApiKey>;
  /** Revoke: the key stops authenticating at once. False when it isn't this merchant's. */
  deleteApiKey(merchantId: string, keyId: string): Promise<boolean>;
  /** For the checkout API later: find a key by the hash of a presented secret. */
  findApiKeyBySecretHash(secretHash: string): Promise<{ merchantId: string; key: StoredApiKey } | null>;

  listWebhooks(merchantId: string): Promise<StoredWebhook[]>;
  getWebhook(merchantId: string, endpointId: string): Promise<StoredWebhook | null>;
  insertWebhook(merchantId: string, endpoint: StoredWebhook): Promise<StoredWebhook>;
  updateWebhook(
    merchantId: string,
    endpointId: string,
    patch: Partial<Pick<StoredWebhook, "url" | "events" | "enabled">>,
  ): Promise<StoredWebhook | null>;
  deleteWebhook(merchantId: string, endpointId: string): Promise<boolean>;
  listDeliveries(merchantId: string): Promise<WebhookDelivery[]>;
  insertDelivery(merchantId: string, delivery: WebhookDelivery): Promise<WebhookDelivery>;
}

export class InsufficientBalance extends Error {
  constructor(readonly availableCents: Cents) {
    super("insufficient balance");
    this.name = "InsufficientBalance";
  }
}

/* ── In-memory implementation ───────────────────────────────────────────── */

type Book = {
  merchant: Merchant;
  links: PaymentLink[];
  payments: Payment[];
  plans: Plan[];
  collector: CollectorStatus;
  balanceCents: Cents;
  payouts: Payout[];
  auto: AutoPayouts;
  apiKeys: StoredApiKey[];
  webhooks: StoredWebhook[];
  deliveries: WebhookDelivery[];
};

const MAX_DELIVERIES = 100;
const clone = <T,>(value: T): T => structuredClone(value);

class MemoryStore implements MerchantStore {
  private books = new Map<string, Book>();

  private book(merchantId: string): Book {
    const book = this.books.get(merchantId);
    if (!book) throw new Error(`Unknown merchant ${merchantId}; call ensureMerchant first.`);
    return book;
  }

  async ensureMerchant(identity: Identity): Promise<Merchant> {
    let book = this.books.get(identity.id);
    if (!book) {
      const sample = seedMerchantBook(identity.id);
      book = {
        merchant: {
          id: identity.id,
          businessName: null,
          walletAddress: identity.walletAddress,
          email: identity.email,
          createdAt: new Date().toISOString(),
        },
        links: sample.links,
        payments: sample.payments,
        plans: sample.plans,
        collector: sample.collector,
        balanceCents: sample.balanceCents,
        payouts: sample.payouts,
        auto: { enabled: false, payoutAddress: null, policyId: null, hourUtc: 17, nextRunAt: null },
        apiKeys: [],
        webhooks: [],
        deliveries: [],
      };
      this.books.set(identity.id, book);
    } else {
      // Privy is the source of truth for the wallet and email; keep ours in step.
      if (identity.walletAddress) book.merchant.walletAddress = identity.walletAddress;
      if (identity.email) book.merchant.email = identity.email;
    }
    return clone(book.merchant);
  }

  async updateMerchant(id: string, patch: { businessName?: string }): Promise<Merchant> {
    const book = this.book(id);
    if (patch.businessName !== undefined) book.merchant.businessName = patch.businessName;
    return clone(book.merchant);
  }

  async listLinks(merchantId: string) {
    return clone(this.book(merchantId).links);
  }

  async insertLink(merchantId: string, link: PaymentLink) {
    this.book(merchantId).links.unshift(clone(link));
    return clone(link);
  }

  async updateLink(merchantId: string, linkId: string, patch: { status: PaymentLink["status"] }) {
    const link = this.book(merchantId).links.find((l) => l.id === linkId);
    if (!link) return null;
    link.status = patch.status;
    return clone(link);
  }

  async listPayments(merchantId: string) {
    return clone(this.book(merchantId).payments);
  }

  async listPlans(merchantId: string) {
    return clone(this.book(merchantId).plans);
  }

  async getCollector(merchantId: string) {
    return clone(this.book(merchantId).collector);
  }

  async getBalance(merchantId: string) {
    return this.book(merchantId).balanceCents;
  }

  async listPayouts(merchantId: string) {
    return clone(this.book(merchantId).payouts);
  }

  async recordPayout(merchantId: string, payout: Payout) {
    const book = this.book(merchantId);
    // Synchronous check-and-debit: no other request can interleave in between.
    if (payout.amountCents > book.balanceCents) throw new InsufficientBalance(book.balanceCents);
    book.balanceCents -= payout.amountCents;
    book.payouts.unshift(clone(payout));
    return clone(payout);
  }

  async getAutoPayouts(merchantId: string) {
    return clone(this.book(merchantId).auto);
  }

  async setAutoPayouts(merchantId: string, auto: AutoPayouts) {
    this.book(merchantId).auto = clone(auto);
    return clone(auto);
  }

  async listApiKeys(merchantId: string) {
    return clone(this.book(merchantId).apiKeys);
  }

  async insertApiKey(merchantId: string, key: StoredApiKey) {
    this.book(merchantId).apiKeys.unshift(clone(key));
    return clone(key);
  }

  async deleteApiKey(merchantId: string, keyId: string) {
    const book = this.book(merchantId);
    const before = book.apiKeys.length;
    book.apiKeys = book.apiKeys.filter((k) => k.id !== keyId);
    return book.apiKeys.length !== before;
  }

  async findApiKeyBySecretHash(secretHash: string) {
    for (const [merchantId, book] of this.books) {
      const key = book.apiKeys.find((k) => k.secretHash === secretHash);
      if (key) return { merchantId, key: clone(key) };
    }
    return null;
  }

  async listWebhooks(merchantId: string) {
    return clone(this.book(merchantId).webhooks);
  }

  async getWebhook(merchantId: string, endpointId: string) {
    const found = this.book(merchantId).webhooks.find((w) => w.id === endpointId);
    return found ? clone(found) : null;
  }

  async insertWebhook(merchantId: string, endpoint: StoredWebhook) {
    this.book(merchantId).webhooks.push(clone(endpoint));
    return clone(endpoint);
  }

  async updateWebhook(merchantId: string, endpointId: string, patch: Partial<Pick<StoredWebhook, "url" | "events" | "enabled">>) {
    const endpoint = this.book(merchantId).webhooks.find((w) => w.id === endpointId);
    if (!endpoint) return null;
    Object.assign(endpoint, clone(patch));
    return clone(endpoint);
  }

  async deleteWebhook(merchantId: string, endpointId: string) {
    const book = this.book(merchantId);
    const before = book.webhooks.length;
    book.webhooks = book.webhooks.filter((w) => w.id !== endpointId);
    return book.webhooks.length !== before;
  }

  async listDeliveries(merchantId: string) {
    return clone(this.book(merchantId).deliveries);
  }

  async insertDelivery(merchantId: string, delivery: WebhookDelivery) {
    const book = this.book(merchantId);
    book.deliveries.unshift(clone(delivery));
    book.deliveries.length = Math.min(book.deliveries.length, MAX_DELIVERIES);
    return clone(delivery);
  }
}

/* ── The one store for this process ─────────────────────────────────────── */

const globalForStore = globalThis as typeof globalThis & { __polarisBusinessStore?: MerchantStore };

/**
 * Kept on `globalThis` so dev-server hot reloads don't wipe it. In production
 * each server instance has its own copy, which is exactly why this is a
 * placeholder: return the database implementation from here instead.
 */
export function getStore(): MerchantStore {
  globalForStore.__polarisBusinessStore ??= new MemoryStore();
  return globalForStore.__polarisBusinessStore;
}
