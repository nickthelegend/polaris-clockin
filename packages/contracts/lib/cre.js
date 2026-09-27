/**
 * Chainlink CRE report encoding for the Polaris receivers.
 *
 * The CRE workflows (TypeScript, @chainlink/cre-sdk) build the same bytes with
 * viem's encodeAbiParameters; these ethers helpers are what the tests and the
 * local end-to-end run use, and what a fallback keeper can use to build a
 * report by hand. See docs in CollectionsReceiver.sol and
 * UnderwritingReceiver.sol for the formats, and docs/research/cre.md section 7.4
 * for the forwarder's raw-report header.
 */

"use strict";

const { AbiCoder, solidityPacked, sha256, toUtf8Bytes, hexlify, zeroPadValue, ZeroHash } = require("ethers");

const coder = AbiCoder.defaultAbiCoder();

/** Report kinds: the first word of each report body. */
const REPORT_KIND = { COLLECTIONS: 1, UNDERWRITING: 2 };

/** CollectionsReceiver task actions. */
const ACTION = { COLLECT_INSTALLMENT: 1, CHARGE_SUBSCRIPTION: 2, LIQUIDATE: 3 };

/** The workflow names in cre/<workflow>/workflow.yaml. */
const WORKFLOW_NAMES = { COLLECTIONS: "polaris-collections", UNDERWRITING: "polaris-underwrite" };

const TASKS_TYPE = "tuple(uint8 action,uint256 id)[]";
const FACTS_TYPE =
  "tuple(uint32 walletAgeDays,uint32 txCount,uint64 stableBalance,uint32 defiTenureDays,uint16 priorLiquidations,uint16 relatedWallets,bool exchangeFunded,uint64 observedAt)";
const UNDERWRITINGS_TYPE = `tuple(address user,address linkedWallet,${FACTS_TYPE} facts)[]`;

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
  TASKS_TYPE,
  FACTS_TYPE,
  UNDERWRITINGS_TYPE,
  encodeCollectionsReport,
  encodeUnderwritingReport,
  encodeRawReport,
  workflowNameBytes10,
};
