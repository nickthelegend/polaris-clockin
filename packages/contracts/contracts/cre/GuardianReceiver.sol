// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {PolarisReceiver} from "./PolarisReceiver.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";
import {ICreditGuard} from "../interfaces/ICreditGuard.sol";

/// The credit pool the guardian attests: PolarisLoanEngine.
interface IPolarisPool {
    /// Same layout as PolarisLoanEngine.PoolState.
    struct PoolState {
        uint256 freeCash;
        uint256 totalOwed;
        uint256 badDebt;
        uint256 totalOriginated;
    }

    function poolState() external view returns (PoolState memory);
    function stablecoin() external view returns (address);
}

/**
 * @title GuardianReceiver
 * @notice Receives the Chainlink CRE `polaris-guardian` workflow's signed pool
 *         attestation, and with it decides whether PolarisCheckout may open
 *         new Pay in 4 plans. Pay now, Send and Subscribe never ask it.
 *
 * @dev The workflow runs on a cron. Each run it reads, in one DON:
 *        - Chainlink's AUSD/USD feed on Monad MAINNET (latestRoundData), the
 *          real price of the real coin (the testnet has no AUSD feed);
 *        - the pool on Monad testnet: `currentInputs()` here returns the loan
 *          engine's `poolState()` (free cash, what buyers owe, bad debt,
 *          lifetime originations) and this contract's thresholds;
 *      computes the verdict, reaches consensus, and writes one report.
 *
 *      Report body (after the forwarder strips the 109-byte header):
 *        abi.encode(uint8 kind, Attestation a)   kind == REPORT_KIND (3)
 *        Attestation = (uint80 priceRoundId, int256 price, uint64 priceUpdatedAt,
 *                       uint256 freeCash, uint256 totalOwed, uint256 badDebt,
 *                       uint256 totalOriginated, uint64 observedAt,
 *                       bool creditPaused, uint8 reasons)
 *      `price` is the feed's answer with PRICE_DECIMALS (8) decimals, and
 *      `priceRoundId` and `priceUpdatedAt` are that round's, so anyone can
 *      check the cited round on the mainnet feed. The pool figures are the
 *      DON's read of the engine at `observedAt` (unix seconds; the timestamp
 *      of the testnet block read is the recommended source). The engine's own
 *      views stay the live truth.
 *
 *      The verdict: `reasons` is a bitmask and `creditPaused == (reasons != 0)`.
 *        REASON_DEPEG        1  price < minPrice
 *        REASON_LOW_CASH     2  freeCash < minFreeCash
 *        REASON_BAD_DEBT     4  badDebt > maxBadDebtBps of totalOriginated
 *        REASON_STALE_PRICE  8  priceUpdatedAt == 0, or observedAt - priceUpdatedAt > maxPriceAge
 *      `evaluate(a)` is that formula against the current thresholds. Every
 *      report is re-evaluated here and refused (`AttestationRefused`, with
 *      `VerdictMismatch`) unless the workflow's verdict is exactly the chain's,
 *      so the two computations check each other and the thresholds on chain
 *      are the only policy. A threshold change between the workflow's read and
 *      its write gets one report refused; the next run uses the new values.
 *
 *      Why bad debt is measured against lifetime originations, not against
 *      what buyers owe today: bad debt is cumulative and never falls, while
 *      what buyers owe falls every time a plan is repaid. Against the book
 *      outstanding, a quiet week with no new plans would push the ratio past
 *      the limit with no new loss, and once credit paused the book could only
 *      shrink, so it could never lift. Against lifetime originations the ratio
 *      moves only with new losses or new lending: the standard cumulative loss
 *      rate. A bad-debt pause does not lift by itself (losses are permanent);
 *      resuming is the owner's call (`setOverride`). Depeg, low cash and a
 *      stale price lift on the next healthy report.
 *
 *      Freshness. A report is refused when it is out of order (not newer than
 *      the latest), from more than MAX_CLOCK_SKEW in the future, or already
 *      older than `maxAttestationAge`. Past `maxAttestationAge` the latest
 *      attestation is stale and credit FAILS OPEN: `isCreditPaused()` says
 *      open, because a guardian that stopped reporting (a simulate-only
 *      setup runs nothing on a schedule) must not lock Pay in 4.
 *
 *      Owner override: `setOverride(ForcePause)` pauses credit whatever the
 *      attestation says (reason REASON_OWNER_PAUSE), `setOverride(ForceResume)`
 *      opens it whatever the attestation says, `setOverride(None)` follows
 *      the attestations again. Each is an event.
 *
 *      Pool health as a feed. This contract is an AggregatorV3Interface, so an
 *      app or contract that reads Chainlink feeds reads it the same way:
 *      description "Polaris pool health, computed by CRE", 8 decimals. Each
 *      accepted attestation is a round, and its answer is what the pool can
 *      lend now, in US dollars: free cash valued at the attested AUSD/USD
 *      price, or 0 when the attestation paused credit. startedAt and
 *      updatedAt are the attestation's `observedAt`. A round never changes
 *      after it is written, so an owner override or staleness is not in it;
 *      `creditStatus()` has those. It is a Polaris attestation computed by a
 *      CRE workflow, not a Chainlink Data Feed or Proof of Reserve.
 */
contract GuardianReceiver is PolarisReceiver, AggregatorV3Interface, ICreditGuard {
    uint8 public constant REPORT_KIND = 3;
    /// Decimals of the AUSD/USD answer the report carries, and of this feed.
    uint8 public constant PRICE_DECIMALS = 8;

    uint8 public constant REASON_DEPEG = 1;
    uint8 public constant REASON_LOW_CASH = 2;
    uint8 public constant REASON_BAD_DEBT = 4;
    uint8 public constant REASON_STALE_PRICE = 8;
    /// Only in `isCreditPaused` / `creditStatus`: the owner forced a pause.
    uint8 public constant REASON_OWNER_PAUSE = 0x80;

    /// How far past the block an observation may be dated (DON and chain clocks).
    uint32 public constant MAX_CLOCK_SKEW = 5 minutes;
    /// Longest `maxAttestationAge` the owner may set.
    uint32 public constant MAX_ATTESTATION_AGE_LIMIT = 7 days;

    enum Override {
        None,
        ForceResume,
        ForcePause
    }

    /// One CRE observation of the pool and the peg, and the workflow's verdict.
    struct Attestation {
        /// The AUSD/USD round cited, on Monad mainnet.
        uint80 priceRoundId;
        /// That round's answer, PRICE_DECIMALS decimals.
        int256 price;
        /// That round's updatedAt.
        uint64 priceUpdatedAt;
        /// PolarisLoanEngine.poolState() at observedAt, stablecoin base units.
        uint256 freeCash;
        uint256 totalOwed;
        uint256 badDebt;
        uint256 totalOriginated;
        /// When the DON observed the above, unix seconds.
        uint64 observedAt;
        bool creditPaused;
        uint8 reasons;
    }

    /// The policy. Defaults (decision 9): $0.995, $1,000, 5%, 2 hours.
    struct Thresholds {
        /// Lowest AUSD/USD price that is not a depeg, PRICE_DECIMALS decimals.
        int256 minPrice;
        /// Least free pool cash, stablecoin base units.
        uint256 minFreeCash;
        /// Most bad debt, in basis points of lifetime originations.
        uint16 maxBadDebtBps;
        /// Oldest the cited price may be at observation, seconds.
        uint32 maxPriceAge;
    }

    /// Everything a client needs to show the guard, in one read.
    struct CreditStatus {
        /// What PolarisCheckout.openPlan applies now.
        bool paused;
        /// Why it is paused (0 when open).
        uint8 reasons;
        /// The latest attestation's own verdict.
        bool attestedPaused;
        uint8 attestedReasons;
        /// The latest attestation's observedAt; 0 when there is none.
        uint64 observedAt;
        /// No attestation, or older than maxAttestationAge: credit fails open.
        bool stale;
        Override overrideMode;
        uint32 maxAttestationAge;
        /// Rounds written so far (the feed's latest round id).
        uint80 round;
    }

    /// A feed round, packed in one slot.
    struct Round {
        int192 answer;
        uint64 observedAt;
    }

    IPolarisPool public immutable pool;
    /// 10 ** the pool stablecoin's decimals, to value free cash in dollars.
    uint256 public immutable cashScale;

    Thresholds private _thresholds;
    /// Past this age the latest attestation is stale and credit fails open.
    uint32 public maxAttestationAge;
    Override public overrideMode;

    Attestation private _latest;
    uint80 public latestRound;
    mapping(uint80 => Round) private _rounds;

    /// An attestation was accepted and is now the latest. `round` is the feed round it wrote.
    event CreditGuardUpdated(uint80 indexed round, bool indexed creditPaused, uint8 reasons, Attestation attestation);
    /// A report was well formed but refused; `reason` is one of the errors below. Nothing changed.
    event AttestationRefused(uint64 observedAt, bytes reason);
    event ThresholdsSet(int256 minPrice, uint256 minFreeCash, uint16 maxBadDebtBps, uint32 maxPriceAge);
    event MaxAttestationAgeSet(uint32 maxAttestationAge);
    event CreditGuardOverridden(Override mode);

    error ZeroAddress();
    error InvalidThresholds();
    error InvalidMaxAttestationAge(uint32 maxAttestationAge);
    error RoundNotFound(uint80 roundId);
    /// Refusals, delivered as `AttestationRefused.reason`.
    error ObservationInFuture(uint64 observedAt, uint256 blockTimestamp);
    error AttestationOutOfOrder(uint64 observedAt, uint64 latestObservedAt);
    error AttestationTooOld(uint64 observedAt, uint32 maxAttestationAge);
    error VerdictMismatch(bool reportedPaused, uint8 reportedReasons, uint8 computedReasons);

    constructor(
        address forwarder,
        IPolarisPool _pool,
        address _simulationTransmitter,
        Thresholds memory thresholds_,
        uint32 _maxAttestationAge
    ) PolarisReceiver(forwarder, _simulationTransmitter) {
        if (address(_pool) == address(0)) revert ZeroAddress();
        pool = _pool;
        cashScale = 10 ** IERC20Metadata(_pool.stablecoin()).decimals();
        _setThresholds(thresholds_);
        _setMaxAttestationAge(_maxAttestationAge);
    }

    // -----------------------------------------------------------------
    // Owner
    // -----------------------------------------------------------------

    function setThresholds(Thresholds calldata t) external onlyOwner {
        _setThresholds(t);
    }

    function setMaxAttestationAge(uint32 age) external onlyOwner {
        _setMaxAttestationAge(age);
    }

    /// @notice Force credit paused or open whatever the attestations say, or
    ///         (None) follow them again.
    function setOverride(Override mode) external onlyOwner {
        overrideMode = mode;
        emit CreditGuardOverridden(mode);
    }

    // -----------------------------------------------------------------
    // The guard
    // -----------------------------------------------------------------

    /// @inheritdoc ICreditGuard
    function isCreditPaused() public view returns (bool paused, uint8 reasons) {
        Override mode = overrideMode;
        if (mode == Override.ForcePause) return (true, REASON_OWNER_PAUSE);
        if (mode == Override.ForceResume || isStale()) return (false, 0);
        return (_latest.creditPaused, _latest.reasons);
    }

    /// @notice True when there is no attestation or the latest is older than
    ///         `maxAttestationAge`: credit then fails open.
    function isStale() public view returns (bool) {
        uint64 observedAt = _latest.observedAt;
        return observedAt == 0 || block.timestamp > uint256(observedAt) + maxAttestationAge;
    }

    function creditStatus() external view returns (CreditStatus memory s) {
        (s.paused, s.reasons) = isCreditPaused();
        s.attestedPaused = _latest.creditPaused;
        s.attestedReasons = _latest.reasons;
        s.observedAt = _latest.observedAt;
        s.stale = isStale();
        s.overrideMode = overrideMode;
        s.maxAttestationAge = maxAttestationAge;
        s.round = latestRound;
    }

    function latestAttestation() external view returns (Attestation memory) {
        return _latest;
    }

    function thresholds() external view returns (Thresholds memory) {
        return _thresholds;
    }

    /// @notice The workflow's one read on the pool's chain: the engine's pool
    ///         state now, and the thresholds to judge it by.
    function currentInputs() external view returns (IPolarisPool.PoolState memory state, Thresholds memory limits) {
        return (pool.poolState(), _thresholds);
    }

    /**
     * @notice The verdict for `a` under the current thresholds: the reason
     *         bits, 0 when healthy. The workflow's `reasons` must equal it.
     */
    function evaluate(Attestation memory a) public view returns (uint8 reasons) {
        Thresholds memory t = _thresholds;
        if (a.price < t.minPrice) reasons |= REASON_DEPEG;
        if (a.freeCash < t.minFreeCash) reasons |= REASON_LOW_CASH;
        // badDebt / totalOriginated > maxBadDebtBps / 10_000, exactly (bad
        // debt is an integer, so comparing it to the floored limit is exact).
        if (a.badDebt > Math.mulDiv(a.totalOriginated, t.maxBadDebtBps, 10_000)) reasons |= REASON_BAD_DEBT;
        if (a.priceUpdatedAt == 0 || (a.observedAt > a.priceUpdatedAt && a.observedAt - a.priceUpdatedAt > t.maxPriceAge)) {
            reasons |= REASON_STALE_PRICE;
        }
    }

    // -----------------------------------------------------------------
    // AggregatorV3Interface: pool health as a feed
    // -----------------------------------------------------------------

    function decimals() external pure returns (uint8) {
        return PRICE_DECIMALS;
    }

    function description() external pure returns (string memory) {
        return "Polaris pool health, computed by CRE";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        if (roundId == 0 || roundId > latestRound) revert RoundNotFound(roundId);
        Round memory r = _rounds[roundId];
        return (roundId, r.answer, r.observedAt, r.observedAt, roundId);
    }

    /// @dev All zeros before the first attestation, as a new Chainlink aggregator reads.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        roundId = latestRound;
        if (roundId == 0) return (0, 0, 0, 0, 0);
        Round memory r = _rounds[roundId];
        return (roundId, r.answer, r.observedAt, r.observedAt, roundId);
    }

    // -----------------------------------------------------------------
    // Reports
    // -----------------------------------------------------------------

    function _processReport(bytes calldata report) internal override {
        _checkDelivery();
        _requireKind(report, REPORT_KIND);
        (, Attestation memory a) = abi.decode(report, (uint8, Attestation));

        bytes memory refusal = _refusal(a);
        if (refusal.length != 0) {
            emit AttestationRefused(a.observedAt, refusal);
            return;
        }

        _latest = a;
        uint80 round = latestRound + 1;
        latestRound = round;
        _rounds[round] = Round({answer: SafeCast.toInt192(_lendableUsd(a)), observedAt: a.observedAt});
        emit CreditGuardUpdated(round, a.creditPaused, a.reasons, a);
    }

    /// Why `a` can't be accepted, as an encoded error; empty when it can.
    function _refusal(Attestation memory a) private view returns (bytes memory) {
        if (a.observedAt > block.timestamp + MAX_CLOCK_SKEW) {
            return abi.encodeWithSelector(ObservationInFuture.selector, a.observedAt, block.timestamp);
        }
        uint64 latest = _latest.observedAt;
        if (a.observedAt <= latest) {
            return abi.encodeWithSelector(AttestationOutOfOrder.selector, a.observedAt, latest);
        }
        if (block.timestamp > uint256(a.observedAt) + maxAttestationAge) {
            return abi.encodeWithSelector(AttestationTooOld.selector, a.observedAt, maxAttestationAge);
        }
        uint8 computed = evaluate(a);
        if (a.reasons != computed || a.creditPaused != (computed != 0)) {
            return abi.encodeWithSelector(VerdictMismatch.selector, a.creditPaused, a.reasons, computed);
        }
        return "";
    }

    /// The feed's answer: free cash in dollars (PRICE_DECIMALS) at the attested
    /// price, or 0 when the attestation paused credit.
    function _lendableUsd(Attestation memory a) private view returns (uint256) {
        if (a.creditPaused) return 0;
        // Not paused, so price >= minPrice > 0.
        return Math.mulDiv(a.freeCash, uint256(a.price), cashScale);
    }

    function _setThresholds(Thresholds memory t) private {
        if (t.minPrice <= 0 || t.minPrice > int256(2 * 10 ** PRICE_DECIMALS) || t.maxBadDebtBps > 10_000 || t.maxPriceAge == 0) {
            revert InvalidThresholds();
        }
        _thresholds = t;
        emit ThresholdsSet(t.minPrice, t.minFreeCash, t.maxBadDebtBps, t.maxPriceAge);
    }

    function _setMaxAttestationAge(uint32 age) private {
        if (age == 0 || age > MAX_ATTESTATION_AGE_LIMIT) revert InvalidMaxAttestationAge(age);
        maxAttestationAge = age;
        emit MaxAttestationAgeSet(age);
    }
}
