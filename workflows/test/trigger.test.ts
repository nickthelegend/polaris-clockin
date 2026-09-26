/**
 * Queuing an underwriting run on `cre workflow simulate --listen`.
 */

import { expect, test } from "bun:test";
import { SIMULATOR_TRIGGER_URL, triggerSimulatedUnderwriting } from "../src/trigger.ts";

const user = "0x00000000000000000000000000000000000ac001";

test("posts {input} to the simulator's /trigger, as the CLI's listen server expects", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response("queued", { status: 200 });
  }) as unknown as typeof fetch;
  expect(await triggerSimulatedUnderwriting({ user }, { fetchImpl })).toEqual({ queued: true });
  expect(calls).toEqual([{ url: SIMULATOR_TRIGGER_URL, body: { input: { user } } }]);
});

test("a full queue (429) is reported, not thrown", async () => {
  const fetchImpl = (async () => new Response("queue full", { status: 429 })) as unknown as typeof fetch;
  expect(await triggerSimulatedUnderwriting({ user }, { fetchImpl })).toEqual({ queued: false, status: 429, message: "queue full" });
});

test("refuses a payload the workflow would refuse", async () => {
  await expect(triggerSimulatedUnderwriting({ user: "0x12" } as never)).rejects.toThrow();
});
