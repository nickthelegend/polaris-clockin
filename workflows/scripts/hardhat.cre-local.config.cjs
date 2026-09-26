/**
 * The contracts package's Hardhat config, for a local node that stands in for
 * Monad testnet when simulating the CRE workflows:
 *
 *   - chain id 10143, because `cre workflow simulate` targets the chain named
 *     `monad-testnet`, and the local project.yaml target points that name at
 *     this node;
 *   - port 8620 (POLARIS_CRE_LOCAL_PORT), so it never collides with the
 *     contracts package's own end-to-end node on 8600.
 *
 * Everything else (compiler, sources, artifacts) is packages/contracts', so
 * the same bytecode deploys here as on testnet. Used by scripts/local-chain.mjs.
 */

"use strict";

const path = require("node:path");

const CONTRACTS = path.join(__dirname, "..", "..", "packages", "contracts");
const base = require(path.join(CONTRACTS, "hardhat.config.js"));
const PORT = Number(process.env.POLARIS_CRE_LOCAL_PORT || 8620);

module.exports = {
  ...base,
  paths: { ...(base.paths || {}), root: CONTRACTS },
  networks: {
    ...base.networks,
    hardhat: { ...base.networks.hardhat, chainId: 10143 },
    monadLocal: { url: `http://127.0.0.1:${PORT}`, chainId: 10143 },
  },
};
