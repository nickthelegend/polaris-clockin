/**
 * Start the underwriting API on a port. The gateway (apps/gateway) is the
 * process that calls this; tests call it on port 0.
 */

import { createServer, type Server } from "node:http";
import { createNodeHandler, type HandlerOptions } from "./handler.ts";
import { Underwriter } from "./service.ts";

export interface ServerOptions extends HandlerOptions {
  port?: number;
  host?: string;
  underwriter?: Underwriter;
}

export async function startUnderwritingServer(opts: ServerOptions = {}): Promise<{ server: Server; url: string; underwriter: Underwriter }> {
  const underwriter = opts.underwriter ?? Underwriter.fromEnv();
  const handler = createNodeHandler(underwriter, opts);
  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "internal", message: "underwriting failed" } }));
    });
  });
  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 3510, host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port ?? 3510;
  return { server, url: `http://${host}:${port}`, underwriter };
}
