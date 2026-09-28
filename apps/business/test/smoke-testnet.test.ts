import { describe, expect, it } from "vitest";

// @ts-expect-error: a plain ESM script with no type declarations.
import { keysFrom, preflight } from "../scripts/smoke-testnet.mjs";

/**
 * smoke:testnet's refusals: it writes to Monad testnet only, only against
 * the mock dollar it can mint, and only with the dev relayer the deployment
 * gave its roles. Every refusal happens before anything is sent.
 */

const KEY_A = `0x${"11".repeat(32)}`;
const KEY_B = `0x${"22".repeat(32)}`;
const RELAYER = "0x5e6934725eBCdfcA2d95D991045Fa813B51E2c69";
const record = (over: Record<string, unknown> = {}) => ({
  chainId: 10143,
  contracts: { Stablecoin: { address: "0x3F9554F15f58Bb5900822224f37A05be81eF9723", kind: "MockAUSD" } },
  roles: { relayer: RELAYER },
  ...over,
});
const ready = { keys: { deployer: KEY_A, relayer: KEY_B }, relayerAddress: RELAYER, relayerBalance: 10n ** 18n, deployerBalance: 10n ** 18n, minRelayer: 10n ** 17n, minDeployer: 10n ** 17n };

describe("smoke:testnet preflight", () => {
  it("is ready with the testnet record, both keys, the recorded relayer and MON", () => {
    expect(preflight({ ...ready, record: record() })).toEqual([]);
  });

  it("refuses without a record, on another chain, or with real AUSD it cannot mint", () => {
    expect(preflight({ ...ready, record: null })[0]).toMatch(/deploy:monad/);
    expect(preflight({ ...ready, record: record({ chainId: 143 }) }).join(" ")).toMatch(/only ever writes to Monad testnet/);
    expect(preflight({ ...ready, record: record({ contracts: { Stablecoin: { address: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC", kind: "AUSD" } } }) }).join(" ")).toMatch(/not the mock/);
  });

  it("refuses a relayer key the deployment did not give roles to, missing keys, and empty wallets", () => {
    const other = "0x000000000000000000000000000000000000dEaD";
    expect(preflight({ ...ready, record: record(), relayerAddress: other }).join(" ")).toMatch(/gave operator roles to/);
    expect(preflight({ ...ready, record: record(), keys: { deployer: null, relayer: null } })).toHaveLength(2);
    expect(preflight({ ...ready, record: record(), relayerBalance: 0n, deployerBalance: 0n })).toHaveLength(2);
  });

  it("reads keys with or without 0x and rejects anything else", () => {
    expect(keysFrom({ DEPLOYER_PRIVATE_KEY: "11".repeat(32), TESTNET_RELAYER_PRIVATE_KEY: KEY_B })).toEqual({ deployer: KEY_A, relayer: KEY_B });
    expect(keysFrom({})).toEqual({ deployer: null, relayer: null });
    expect(() => keysFrom({ DEPLOYER_PRIVATE_KEY: "0x1234" })).toThrow(/32-byte hex key/);
  });
});
