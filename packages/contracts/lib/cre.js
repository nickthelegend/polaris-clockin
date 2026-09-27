/**
 * Chainlink CRE report encoding for the Polaris receivers: one report format
 * per workflow, the first word of each body its kind.
 *
 *   kind 1  polaris-collections  -> CollectionsReceiver
 *           abi.encode(uint8 1, (uint8 action, uint256 id)[] tasks)
 *           action 1 collectInstallment(id), 2 chargeDue(id), 3 liquidate(id).
 *           The cron and the instant retry (the EVM log trigger on
 *           PolarisCheckout.Reauthorized) both write it; the retry's tasks are
 *           `CollectionsReceiver.dueTasksFor(buyer)`.
 *   kind 2  polaris-underwrite   -> UnderwritingReceiver
 *           abi.encode(uint8 2, (address user, address linkedWallet, Facts facts)[] items)
 *   kind 3  polaris-guardian     -> GuardianReceiver
 *           abi.encode(uint8 3, Attestation a)
 *           Attestation = (uint80 priceRoundId, int256 price, uint64 priceUpdatedAt,
 *                          uint256 freeCash, uint256 totalOwed, uint256 badDebt,
 *                          uint256 totalOriginated, uint64 observedAt,
 *                          bool creditPaused, uint8 reasons)
 *
 * The CRE workflows (workflows/, TypeScript, @chainlink/cre-sdk) build the same
 * bytes with viem's encodeAbiParameters, and their tests hold them to these
 * byte for byte. These ethers helpers are what the contract tests and the local
 * end-to-end run use to build reports by hand (those reports are hand-built,
 * not CRE output). `guardianReasons` is GuardianReceiver.evaluate in
 * JavaScript, held to the contract by test/metropolis/Guardian.test.js. See the
 * receivers' NatSpec for the formats, and docs/research/cre.md section 7.4 for
 * the forwarder's raw-report header.
 */

"use strict";

const { AbiCoder, solidityPacked, sha256, toUtf8Bytes, hexlify, zeroPadValue, ZeroHash } = require("ethers");

const coder = AbiCoder.defaultAbiCoder();

/** Report kinds: the first word of each report body. */
const REPORT_KIND = { COLLECTIONS: 1, UNDERWRITING: 2, GUARDIAN: 3 };

/** CollectionsReceiver task actions. */
const ACTION = { COLLECT_INSTALLMENT: 1, CHARGE_SUBSCRIPTION: 2, LIQUIDATE: 3 };

/** The workflow names in workflows/<workflow>/workflow.yaml (@polaris/cre-workflows). */
const WORKFLOW_NAMES = { COLLECTIONS: "polaris-collections", UNDERWRITING: "polaris-underwrite", GUARDIAN: "polaris-guardian" };

/** GuardianReceiver reason bits. OWNER_PAUSE only ever appears in isCreditPaused/creditStatus, never in a report. */
const GUARDIAN_REASON = { DEPEG: 1, LOW_CASH: 2, BAD_DEBT: 4, STALE_PRICE: 8, OWNER_PAUSE: 0x80 };

/** GuardianReceiver.Override. */
const GUARDIAN_OVERRIDE = { NONE: 0, FORCE_RESUME: 1, FORCE_PAUSE: 2 };

/** Decimals of the AUSD/USD price in a guardian report, and of the guardian's feed-shaped view. */
const GUARDIAN_PRICE_DECIMALS = 8;

/**
 * Decision 9's thresholds, the deploy defaults: AUSD/USD below $0.995, free pool
 * cash below $1,000, bad debt above 5% of lifetime originations, a price older
 * than 2 hours. Stablecoin amounts are 6-decimal base units.
 */
const GUARDIAN_DEFAULTS = {
  minPrice: 99_500_000n,
  minFreeCash: 1_000_000_000n,
  maxBadDebtBps: 500,
  maxPriceAge: 7_200,
  /** Past this, the latest attestation is stale and credit fails open (decision 10). */
  maxAttestationAge: 3_600,
};

/** Chainlink AUSD/USD on Monad mainnet (chain 143), read by the guardian workflow (decision 11). */
const AUSD_USD_FEED_MONAD_MAINNET = {
  chainId: 143,
  chainSelectorName: "monad-mainnet",
  address: "0xE20751C7B5867bCBef815ffc1b284c3f412a9e13",
  decimals: 8,
  description: "AUSD / USD",
};

const TASKS_TYPE = "tuple(uint8 action,uint256 id)[]";
const FACTS_TYPE =
  "tuple(uint32 walletAgeDays,uint32 txCount,uint64 stableBalance,uint32 defiTenureDays,uint16 priorLiquidations,uint16 relatedWallets,bool exchangeFunded,uint64 observedAt)";
const UNDERWRITINGS_TYPE = `tuple(address user,address linkedWallet,${FACTS_TYPE} facts)[]`;
const ATTESTATION_TYPE =
  "tuple(uint80 priceRoundId,int256 price,uint64 priceUpdatedAt,uint256 freeCash,uint256 totalOwed,uint256 badDebt,uint256 totalOriginated,uint64 observedAt,bool creditPaused,uint8 reasons)";
const ATTESTATION_FIELDS = [
  "priceRoundId",
  "price",
  "priceUpdatedAt",
  "freeCash",
  "totalOwed",
  "badDebt",
  "totalOriginated",
  "observedAt",
  "creditPaused",
  "reasons",
];

/** abi.encode(uint8 1, (uint8 action, uint256 id)[]) for CollectionsReceiver. */
function encodeCollectionsReport(tasks) {
  return coder.encode(["uint8", TASKS_TYPE], [REPORT_KIND.COLLECTIONS, tasks.map((t) => [t.action, t.id])]);
}

/** abi.encode(uint8 2, (address user, address linkedWallet, Facts facts)[]) for UnderwritingReceiver. */
function encodeUnderwritingReport(items) {
  return coder.encode(
    ["uint8", UNDERWRITINGS_TYPE],
    [
      REPORT_KIND.UNDERWRITING,
      items.map((i) => [
        i.user,
        i.linkedWallet ?? "0x0000000000000000000000000000000000000000",
        [
          i.facts.walletAgeDays,
          i.facts.txCount,
          i.facts.stableBalance,
          i.facts.defiTenureDays,
          i.facts.priorLiquidations,
          i.facts.relatedWallets,
          i.facts.exchangeFunded,
          i.facts.observedAt,
        ],
      ]),
    ]
  );
}

/** abi.encode(uint8 3, Attestation) for GuardianReceiver. Numbers may be bigint, number or decimal strings. */
function encodeGuardianReport(a) {
  return coder.encode(["uint8", ATTESTATION_TYPE], [REPORT_KIND.GUARDIAN, ATTESTATION_FIELDS.map((f) => a[f])]);
}

/** Decode a collections report body: { kind, tasks: [{ action, id }] } (numbers as bigint, action as number). */
function decodeCollectionsReport(body) {
  const [kind, tasks] = coder.decode(["uint8", TASKS_TYPE], body);
  return { kind: Number(kind), tasks: tasks.map((t) => ({ action: Number(t.action), id: t.id })) };
}

/** Decode an underwriting report body: { kind, items: [{ user, linkedWallet, facts }] }. */
function decodeUnderwritingReport(body) {
  const [kind, items] = coder.decode(["uint8", UNDERWRITINGS_TYPE], body);
  return {
    kind: Number(kind),
    items: items.map((i) => ({
      user: i.user,
      linkedWallet: i.linkedWallet,
      facts: {
        walletAgeDays: Number(i.facts.walletAgeDays),
        txCount: Number(i.facts.txCount),
        stableBalance: i.facts.stableBalance,
        defiTenureDays: Number(i.facts.defiTenureDays),
        priorLiquidations: Number(i.facts.priorLiquidations),
        relatedWallets: Number(i.facts.relatedWallets),
        exchangeFunded: i.facts.exchangeFunded,
        observedAt: i.facts.observedAt,
      },
    })),
  };
}

/** Decode a guardian report body: { kind, attestation } (uint fields as bigint, reasons as number). */
function decodeGuardianReport(body) {
  const [kind, a] = coder.decode(["uint8", ATTESTATION_TYPE], body);
  const attestation = Object.fromEntries(ATTESTATION_FIELDS.map((f) => [f, a[f]]));
  attestation.reasons = Number(attestation.reasons);
  return { kind: Number(kind), attestation };
}

/** The kind of any Polaris report body (its first word). */
function reportKind(body) {
  return Number(coder.decode(["uint8"], body)[0]);
}

/**
 * GuardianReceiver.evaluate in JavaScript: the reason bits for an attestation
 * under `thresholds` (defaults: GUARDIAN_DEFAULTS). 0 means healthy.
 */
function guardianReasons(a, thresholds = GUARDIAN_DEFAULTS) {
  // An ethers Result (GuardianReceiver.thresholds()) spreads as indices only.
  const given = typeof thresholds?.toObject === "function" ? thresholds.toObject() : thresholds;
  const t = { ...GUARDIAN_DEFAULTS, ...given };
  const big = (v) => BigInt(v);
  let reasons = 0;
  if (big(a.price) < big(t.minPrice)) reasons |= GUARDIAN_REASON.DEPEG;
  if (big(a.freeCash) < big(t.minFreeCash)) reasons |= GUARDIAN_REASON.LOW_CASH;
  if (big(a.badDebt) > (big(a.totalOriginated) * big(t.maxBadDebtBps)) / 10_000n) reasons |= GUARDIAN_REASON.BAD_DEBT;
  const observedAt = big(a.observedAt);
  const updatedAt = big(a.priceUpdatedAt);
  if (updatedAt === 0n || (observedAt > updatedAt && observedAt - updatedAt > big(t.maxPriceAge))) {
    reasons |= GUARDIAN_REASON.STALE_PRICE;
  }
  return reasons;
}

/**
 * Build a whole attestation from its inputs, with the verdict filled in the
 * way GuardianReceiver requires (creditPaused == reasons != 0).
 */
function buildAttestation({ price, priceRoundId, priceUpdatedAt, pool, observedAt }, thresholds = GUARDIAN_DEFAULTS) {
  const a = {
    priceRoundId: big0(priceRoundId),
    price: big0(price),
    priceUpdatedAt: big0(priceUpdatedAt),
    freeCash: big0(pool.freeCash),
    totalOwed: big0(pool.totalOwed),
    badDebt: big0(pool.badDebt),
    totalOriginated: big0(pool.totalOriginated),
    observedAt: big0(observedAt),
  };
  a.reasons = guardianReasons(a, thresholds);
  a.creditPaused = a.reasons !== 0;
  return a;
}

function big0(v) {
  return v === undefined || v === null ? 0n : BigInt(v);
}

/**
 * A workflow name as the forwarder carries it: the first 10 hex characters of
 * sha256(name), as 10 ASCII bytes. Matches ReceiverTemplate.setExpectedWorkflowName;
 * "my_workflow" gives 0x62373666336165316465 (the docs' example).
 */
function workflowNameBytes10(name) {
  const hex = sha256(toUtf8Bytes(name)).slice(2, 12);
  return hexlify(toUtf8Bytes(hex));
}

/**
 * The raw report a KeystoneForwarder's `report()` takes: the 109-byte header,
 * then the body. `workflowName` may be a plain name (hashed here) or a
 * ready bytes10 hex string.
 */
function encodeRawReport({
  body,
  workflowId = ZeroHash,
  workflowName = "",
  workflowOwner = "0x0000000000000000000000000000000000000000",
  executionId = ZeroHash,
  reportId = "0x0001",
  timestamp = Math.floor(Date.now() / 1000),
  donId = 1,
  donConfigVersion = 1,
  version = 1,
}) {
  const name =
    typeof workflowName === "string" && /^0x[0-9a-fA-F]{20}$/.test(workflowName)
      ? workflowName
      : workflowName === ""
        ? zeroPadValue("0x", 10)
        : workflowNameBytes10(workflowName);
  return solidityPacked(
    ["uint8", "bytes32", "uint32", "uint32", "uint32", "bytes32", "bytes10", "address", "bytes2", "bytes"],
    [version, executionId, timestamp, donId, donConfigVersion, workflowId, name, workflowOwner, reportId, body]
  );
}

module.exports = {
  REPORT_KIND,
  ACTION,
  WORKFLOW_NAMES,
  GUARDIAN_REASON,
  GUARDIAN_OVERRIDE,
  GUARDIAN_PRICE_DECIMALS,
  GUARDIAN_DEFAULTS,
  AUSD_USD_FEED_MONAD_MAINNET,
  TASKS_TYPE,
  FACTS_TYPE,
  UNDERWRITINGS_TYPE,
  ATTESTATION_TYPE,
  ATTESTATION_FIELDS,
  encodeCollectionsReport,
  encodeUnderwritingReport,
  encodeGuardianReport,
  decodeCollectionsReport,
  decodeUnderwritingReport,
  decodeGuardianReport,
  reportKind,
  guardianReasons,
  buildAttestation,
  encodeRawReport,
  workflowNameBytes10,
};
