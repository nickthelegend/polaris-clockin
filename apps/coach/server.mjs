// Polaris Coach server. The app (EXPO_PUBLIC_COACH_URL) posts the system
// prompt and the user's on-chain facts; this calls Claude with the key it
// holds (ANTHROPIC_API_KEY, or an `ant auth login` profile) and returns text.
// Not deployed anywhere: see HANDOFF.md for how to host it.
//   ANTHROPIC_API_KEY=... PORT=4210 node server.mjs
import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const PORT = Number(process.env.PORT ?? 4210);
const MODEL = process.env.COACH_MODEL ?? "claude-opus-5-5";
const MAX_BODY = 16_000;

export function makeHandler(client = new Anthropic()) {
  return async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, model: MODEL });
    if (req.method !== "POST" || req.url !== "/coach") return send(404, { error: "not found" });
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return send(413, { error: "too large" });
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(400, { error: "bad json" });
    }
    if (typeof body.system !== "string" || typeof body.content !== "string") return send(400, { error: "system and content required" });
    try {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: body.system,
        messages: [{ role: "user", content: body.content }],
      });
      if (msg.stop_reason === "refusal") return send(200, { text: "The coach can't help with that one." });
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return send(200, { text });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return send(429, { error: "rate limited" });
      if (e instanceof Anthropic.APIError) return send(502, { error: `upstream ${e.status ?? ""}` });
      return send(500, { error: "coach failed" });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  http.createServer(makeHandler()).listen(PORT, () => console.log(`coach on :${PORT} (${MODEL})`));
}
