/**
 * End to end on a local chain: the BUILT SDK (dist/cjs) against the real
 * PolarisPayments and MockAUSD, compiled from packages/contracts.
 *
 *   pnpm --filter polarispay-sdk test:chain
 *
 * (builds the SDK, then runs this with `hardhat run` from packages/contracts,
 * on Hardhat's in-process network: no node to start, nothing public.)
 *
 * It proves three things the unit tests can only mock:
 *   1. pay() from a wallet that holds gas settles the order on chain.
 *   2. pay() with a relayUrl settles it for a buyer holding ZERO native gas:
 *      the buyer only signs, a relayer account submits.
 *   3. The relayer can't redirect that signature to another merchant.
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const hre = require(require.resolve("hardhat", { paths: [process.cwd()] }));
const sdk = require(path.join(__dirname, "..", "..", "dist", "cjs", "index.js"));

const { ethers } = hre;
const AUSD = (n) => ethers.parseUnits(String(n), 6);

/** Hardhat's provider, speaking as one of its unlocked accounts. */
function accountProvider(base, address) {
  return {
    request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return Promise.resolve([address]);
      return base.request({ method, params });
    },
  };
}

/** A wallet that exists only as a key (no gas, never funded with ETH), reading the chain through Hardhat. */
function keyProvider(base, wallet) {
  return {
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [wallet.address];
        case "eth_signTypedData_v4": {
          const typed = JSON.parse(params[1]);
          const { EIP712Domain, ...types } = typed.types;
          return wallet.signTypedData(typed.domain, types, typed.message);
        }
        case "eth_sendTransaction":
          throw new Error("a gasless buyer must never send a transaction");
        default:
          return base.request({ method, params });
      }
    },
  };
}

async function main() {
  const [owner, treasury, merchant, relayer, buyer, rival] = await ethers.getSigners();
  const ausd = await (await ethers.getContractFactory("MockAUSD")).deploy();
  const payments = await (await ethers.getContractFactory("PolarisPayments")).deploy(owner.address, await ausd.getAddress(), treasury.address, 0);

  const chain = {
    ...sdk.MONAD_TESTNET,
    key: "hardhat",
    chainId: 31337,
    name: "Hardhat",
    rpcUrl: "http://127.0.0.1:8545",
    explorer: "http://localhost/explorer",
    stablecoin: await ausd.getAddress(),
    payments: await payments.getAddress(),
  };

  // 1. Wallet-sent.
  await ausd.mint(buyer.address, AUSD(1_000));
  const walletClient = sdk.createPolaris({
    publishableKey: "pk_test_localchain0001",
    chain,
    provider: accountProvider(hre.network.provider, buyer.address),
  });
  const before = await ausd.balanceOf(merchant.address);
  const r1 = await walletClient.pay({ merchant: merchant.address, amount: "25.00", orderId: "e2e-wallet-1" });
  assert.equal(r1.ok, true, r1.error);
  assert.equal(r1.relayed, false);
  // 0.5% protocol fee: the merchant nets 24.875.
  assert.equal((await ausd.balanceOf(merchant.address)) - before, AUSD("24.875"));
  const recorded = await walletClient.getPayment({ merchant: merchant.address, orderId: "e2e-wallet-1" });
  assert.equal(recorded.payer, buyer.address);
  assert.equal(recorded.amount, "25.00");
  const again = await walletClient.pay({ merchant: merchant.address, amount: "25.00", orderId: "e2e-wallet-1" });
  assert.deepEqual([again.ok, again.error], [false, "This order has already been paid."]);
  console.log(`  ✓ wallet pay settled: ${r1.transactionHash}`);

  // 2. Gasless through a relay: the buyer has AUSD and no ETH at all.
  const gasless = ethers.Wallet.createRandom();
  await ausd.mint(gasless.address, AUSD(500));
  assert.equal(await ethers.provider.getBalance(gasless.address), 0n);

  let lastRelayBody;
  const relayFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    lastRelayBody = body;
    assert.equal(init.headers.Authorization, "Bearer pk_test_localchain0001");
    assert.equal(body.contract, chain.payments);
    const sig = ethers.Signature.from(body.signature);
    const tx = await payments
      .connect(relayer)
      .payWithAuthorization(body.payer, body.merchant, BigInt(body.amount), body.orderId, BigInt(body.validAfter), BigInt(body.validBefore), sig.v, sig.r, sig.s);
    await tx.wait();
    return new Response(JSON.stringify({ data: { txHash: tx.hash, status: "confirmed" } }), { status: 201 });
  };
  const gaslessClient = sdk.createPolaris({
    publishableKey: "pk_test_localchain0001",
    chain,
    provider: keyProvider(hre.network.provider, gasless),
    relayUrl: "http://relay.local/api/v1/relay/payments",
    fetch: relayFetch,
  });
  const merchantBefore = await ausd.balanceOf(merchant.address);
  const r2 = await gaslessClient.pay({ merchant: merchant.address, amount: "200.00", orderId: "e2e-gasless-1" });
  assert.equal(r2.ok, true, r2.error);
  assert.equal(r2.relayed, true);
  assert.equal(await ethers.provider.getBalance(gasless.address), 0n, "the buyer never spent gas");
  assert.equal(await ausd.balanceOf(gasless.address), AUSD(300));
  assert.equal((await ausd.balanceOf(merchant.address)) - merchantBefore, AUSD(199));
  console.log(`  ✓ gasless pay settled by the relayer, buyer ETH balance 0: ${r2.transactionHash}`);

  // 3. The same signature can't be pointed at another merchant.
  const replay = { ...lastRelayBody, merchant: rival.address, orderId: "e2e-gasless-2" };
  const sig = ethers.Signature.from(replay.signature);
  await assert.rejects(
    payments
      .connect(relayer)
      .payWithAuthorization(replay.payer, replay.merchant, BigInt(replay.amount), replay.orderId, BigInt(replay.validAfter), BigInt(replay.validBefore), sig.v, sig.r, sig.s),
    /InvalidAuthorizationSignature|reverted/,
  );
  console.log("  ✓ a relayer can't redirect the buyer's signature to another merchant");

  console.log("\npolarispay-sdk e2e on a local chain: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
