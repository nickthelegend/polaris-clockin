import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Order } from "./types";

/**
 * The order store: one JSON file under apps/shop/.data (git-ignored), with an
 * in-memory fallback when the disk can't be written (a read-only deploy).
 * Every change goes through `update`, which runs one at a time, so a webhook
 * and a page poll never interleave a read-modify-write.
 */

export interface StoreData {
  orders: Record<string, Order>;
  /** Idempotency-Key from the checkout page → the order it created. */
  idempotency: Record<string, { orderId: string; fingerprint: string; createdAt: string }>;
  /** Every verified event id, including ones that weren't about an order. */
  events: Record<string, { type: string; receivedAt: string; orderId: string | null }>;
}

const empty = (): StoreData => ({ orders: {}, idempotency: {}, events: {} });

export interface OrderStore {
  read(): Promise<StoreData>;
  update<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T>;
}

export function createMemoryStore(initial: StoreData = empty()): OrderStore {
  let data = structuredClone(initial);
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async read() {
      await queue.catch(() => {});
      return structuredClone(data);
    },
    update<T>(fn: (d: StoreData) => T | Promise<T>): Promise<T> {
      const run = queue.then(async () => {
        const draft = structuredClone(data);
        const result = await fn(draft);
        data = draft;
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

export function createFileStore(file: string): OrderStore {
  let cache: StoreData | null = null;
  let diskOk = true;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<StoreData> {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<StoreData>;
      cache = { ...empty(), ...parsed };
    } catch {
      cache = empty();
    }
    return cache;
  }

  async function persist(data: StoreData) {
    if (!diskOk) return;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
      await rename(tmp, file);
    } catch (error) {
      diskOk = false;
      console.warn(`[orders] Couldn't write ${file}; keeping orders in memory from now on.`, error);
    }
  }

  return {
    async read() {
      await queue.catch(() => {});
      return structuredClone(await load());
    },
    update<T>(fn: (d: StoreData) => T | Promise<T>): Promise<T> {
      const run = queue.then(async () => {
        const draft = structuredClone(await load());
        const result = await fn(draft);
        cache = draft;
        await persist(draft);
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

const globalStore = globalThis as unknown as { __halcyonOrderStore?: OrderStore };

/** The process-wide store. Survives hot reloads in dev. */
export function orderStore(): OrderStore {
  if (!globalStore.__halcyonOrderStore) {
    const dir = process.env.SHOP_DATA_DIR ?? path.join(process.cwd(), ".data");
    globalStore.__halcyonOrderStore =
      process.env.SHOP_ORDER_STORE === "memory" ? createMemoryStore() : createFileStore(path.join(dir, "orders.json"));
  }
  return globalStore.__halcyonOrderStore;
}

/** Tests swap in a memory store. */
export function setOrderStore(store: OrderStore) {
  globalStore.__halcyonOrderStore = store;
}
