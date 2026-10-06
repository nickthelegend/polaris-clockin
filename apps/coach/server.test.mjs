// Exercises the handler with a stub client (no network, no key).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeHandler } from "./server.mjs";

const stub = { messages: { create: async (p) => ({ stop_reason: "end_turn", content: [{ type: "text", text: `ok:${p.model}:${p.messages[0].content.length}` }] }) } };

async function call(server, method, path, body) {
  const { port } = server.address();
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, body: body && JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { status: r.status, json: await r.json() };
}

test("coach handler", async () => {
  const server = http.createServer(makeHandler(stub)).listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    assert.equal((await call(server, "GET", "/health")).status, 200);
    const ok = await call(server, "POST", "/coach", { system: "s", content: "facts" });
    assert.equal(ok.status, 200);
    assert.match(ok.json.text, /^ok:claude-opus-5-5:5$/);
    assert.equal((await call(server, "POST", "/coach", { content: "x" })).status, 400);
    assert.equal((await call(server, "POST", "/nope", {})).status, 404);
  } finally {
    server.close();
  }
});
