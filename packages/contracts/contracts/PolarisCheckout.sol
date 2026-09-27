// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {PolarisLoanEngine} from "./PolarisLoanEngine.sol";
import {PolarisPayments} from "./PolarisPayments.sol";
import {ScoreManager} from "./ScoreManager.sol";

/**
 * @title PolarisCheckout
 * @notice The one front door for a buyer paying a merchant's order: Pay now,
 *         Pay in 4 on the buyer's Polaris credit line, or Subscribe. Every
 *         entry point takes the buyer's signatures and nothing else, so a
 *         relayer submits them and the buyer never holds gas.
 *
 * @dev It is the only originator the loan engine accepts, so no plan exists
 *      that a buyer did not sign for here. The three modes:
 *
 *        pay(...)        Pay now. The buyer's ERC-3009 ReceiveWithAuthorization,
 *                        payable to PolarisPayments, with the nonce
 *                        keccak256(merchant, orderId). PolarisPayments derives
 *                        that nonce itself, so the signature commits to this
 *                        merchant and this order; this contract adds the
 *                        cross-mode order guard and the CheckoutPaid event.
 *        openPlan(...)   Pay in 4. The buyer's EIP-712 PlanIntent plus an
 *                        ERC-2612 permit to the loan engine. The merchant is
 *                        paid the whole principal from the credit pool in the
 *                        same transaction, and the permit is the standing
 *                        allowance every instalment is later collected from.
 *        subscribe(...)  Subscribe. The buyer's EIP-712 SubscribeIntent plus an
 *                        ERC-2612 permit to PolarisPayments, which then charges
 *                        the first period through `subscribeFor`.
 *
 *      An order is `keccak256(abi.encodePacked(merchant, orderId))`, the same
 *      id PolarisPayments uses for a payment, and it settles once, in one mode.
 *      Paying an order now and also opening a plan on it would charge the buyer
 *      twice for one purchase, so each mode refuses an order the others (or
 *      PolarisPayments directly) already settled, and every mode honours a
 *      price the session service pinned with `PolarisPayments.quoteOrder`.
 *
 *      Why Pay in 4 takes a permit and not an ERC-3009 authorization: nothing
 *      moves at origination. The merchant is paid from the pool, and the
 *      buyer's money moves later, one instalment at a time, pulled by whoever
 *      collects. That needs a standing allowance, and ERC-2612 is the only way
 *      a buyer can grant one by signature. ERC-3009 is used where money moves
 *      at once: Pay now, and PolarisSend.
 *
 *      Intents are short-lived and ordered. A deadline may be at most
 *      MAX_SIGNATURE_WINDOW past the block it lands in, so a relayer cannot sit
 *      on a signed plan and open it days later, and each buyer has one
 *      sequential nonce here, shared by PlanIntent and SubscribeIntent, so a
 *      newer intent retires every older one still unspent.
 *
 *      EIP-712 domain: name "PolarisCheckout", version "1", the chain id and
 *      this contract's address (read it with `eip712Domain()`, ERC-5267).
 *        PlanIntent(address buyer,address merchant,uint256 principal,
 *                   uint32 installments,uint64 interval,string orderId,
 *                   uint256 nonce,uint256 deadline)
 *        SubscribeIntent(address buyer,address merchant,uint256 planId,
 *                        uint256 pricePerPeriod,uint64 periodSeconds,
 *                        string orderId,uint256 nonce,uint256 deadline)
 *      Signatures are checked with SignatureChecker, so an ERC-1271 smart
 *      account can buy as well as a Mera EOA.
 */
contract PolarisCheckout is Ownable, Pausable, ReentrancyGuard, EIP712, Nonces {
    /// What a buyer signs to open a Pay in 4 plan.
    bytes32 public constant PLAN_INTENT_TYPEHASH = keccak256(
        "PlanIntent(address buyer,address merchant,uint256 principal,uint32 installments,uint64 interval,string orderId,uint256 nonce,uint256 deadline)"
    );
    /// What a buyer signs to subscribe to a merchant's plan.
    bytes32 public constant SUBSCRIBE_INTENT_TYPEHASH = keccak256(
        "SubscribeIntent(address buyer,address merchant,uint256 planId,uint256 pricePerPeriod,uint64 periodSeconds,string orderId,uint256 nonce,uint256 deadline)"
    );

    /// Longest an intent may still have to run when it lands. Apps sign a few
    /// minutes; the hour is headroom for slow relaying and clock drift.
    uint64 public constant MAX_SIGNATURE_WINDOW = 1 hours;

    enum OrderKind {
        None,
        PayNow,
        PayIn4,
        Subscription
    }

    /// How an order was settled, in two storage slots. `amount` is what the
    /// merchant priced it at: the payment, the plan's principal, or one
    /// period of the subscription. `ref` is the loan id for Pay in 4 and the
    /// subscription id for Subscribe; Pay now needs none, because its payment
    /// id is the order key. The merchant is part of the key.
    struct Order {
        OrderKind kind;
        uint64 settledAt;
        address buyer;
        uint128 amount;
        uint128 ref;
    }

    struct PlanIntent {
        address buyer;
        address merchant;
        uint256 principal;
        uint32 installments;
        uint64 interval;
        string orderId;
        uint256 nonce;
        uint256 deadline;
    }

    struct SubscribeIntent {
        address buyer;
        address merchant;
        uint256 planId;
        uint256 pricePerPeriod;
        uint64 periodSeconds;
        string orderId;
        uint256 nonce;
        uint256 deadline;
    }

    /// An ERC-2612 permit, relayed with the intent. `deadline == 0` means
    /// "no permit": the buyer's standing allowance is used as it is.
    struct PermitSignature {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// Everything the app shows before the buyer confirms Pay in 4.
    struct PlanQuote {
        uint256 totalOwed;
        uint256 interest;
        /// The first instalment. Instalments are equal to within one base
        /// unit; the engine's `thresholdFor` ladder rounds each one up.
        uint256 installmentAmount;
        /// What the buyer's permit to the loan engine must be for: everything
        /// they already owe it plus this plan. A permit replaces the allowance
        /// rather than adding to it, so sizing it for this plan alone would
        /// strand the plans already open.
        uint256 permitValue;
        uint256 creditLimit;
        uint256 activeDebt;
        uint256 available;
        bool withinLimit;
    }

    IERC20 public immutable stablecoin;
    PolarisLoanEngine public immutable loanEngine;
    PolarisPayments public immutable payments;
    ScoreManager public immutable scoreManager;

    /// Settled orders by order key.
    mapping(bytes32 => Order) public orders;

    /// Pay now settled an order. PolarisPayments emits PaymentMade in the same
    /// transaction; this adds the checkout's view of it.
    event CheckoutPaid(
        bytes32 indexed orderKey,
        address indexed merchant,
        address indexed buyer,
        string orderId,
        uint256 amount,
        uint256 fee
    );
    /// Pay in 4 opened a plan and paid the merchant the whole principal.
    /// Instalment i (0-based) falls due at firstDueAt + i * interval.
    event PlanOpened(
        bytes32 indexed orderKey,
        address indexed merchant,
        address indexed buyer,
        uint256 loanId,
        string orderId,
        uint256 principal,
        uint256 totalOwed,
        uint32 installments,
        uint64 interval,
        uint64 firstDueAt
    );
    /// A subscription started and its first period was charged.
    event SubscriptionStarted(
        bytes32 indexed orderKey,
        address indexed merchant,
        address indexed buyer,
        uint256 subId,
        uint256 planId,
        string orderId,
        uint256 pricePerPeriod,
        uint64 periodSeconds,
        uint64 nextChargeAt
    );
    /// A buyer retired their next intent without using it.
    event NonceInvalidated(address indexed buyer, uint256 nonce);

    error ZeroAddress();
    error EmptyOrderId();
    error SignatureExpired();
    error SignatureWindowTooLong();
    error InvalidSignature();
    error OrderAlreadySettled(bytes32 orderKey);
    error WrongAmount(uint256 quoted, uint256 offered);
    error PlanMismatch(uint256 planId);
    error WrongStablecoin();
    error WrongScoreManager();

    constructor(
        address initialOwner,
        PolarisLoanEngine _loanEngine,
        PolarisPayments _payments,
        ScoreManager _scoreManager
    ) Ownable(initialOwner) EIP712("PolarisCheckout", "1") {
        if (
            address(_loanEngine) == address(0) ||
            address(_payments) == address(0) ||
            address(_scoreManager) == address(0)
        ) revert ZeroAddress();
        // One dollar for the whole checkout: a plan and a payment in different
        // tokens would settle one order in two currencies.
        IERC20 token = _loanEngine.stablecoin();
        if (address(_payments.stablecoin()) != address(token)) revert WrongStablecoin();
        if (address(_loanEngine.scoreManager()) != address(_scoreManager)) revert WrongScoreManager();
        stablecoin = token;
        loanEngine = _loanEngine;
        payments = _payments;
        scoreManager = _scoreManager;
    }

    // -----------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------

    /// @notice Stop new checkouts. Collections, repayments, cancellations and
    ///         everything already open are untouched.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // -----------------------------------------------------------------
    // Pay now
    // -----------------------------------------------------------------

    /**
     * @notice Pay a merchant's order in full, now, from the buyer's ERC-3009
     *         authorization. Anyone may submit it.
     * @dev The buyer signs `ReceiveWithAuthorization` on the stablecoin with
     *      `to = PolarisPayments` and `nonce = keccak256(abi.encodePacked(
     *      merchant, orderId))`. PolarisPayments derives the nonce itself, so a
     *      relayer that changes the merchant, the order or the amount gets the
     *      token's signature error, not a payment.
     *
     *      The same authorization can also be submitted to PolarisPayments
     *      directly; the money moves the same way and only CheckoutPaid is
     *      missing. Either way the order is then settled, and `openPlan` and
     *      `subscribe` refuse it.
     */
    function pay(
        address buyer,
        address merchant,
        uint256 amount,
        string calldata orderId,
        uint256 validAfter,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused returns (bytes32 orderKey) {
        if (buyer == address(0) || merchant == address(0)) revert ZeroAddress();
        orderKey = _claimOrder(merchant, orderId, amount);
        _record(orderKey, OrderKind.PayNow, buyer, amount);

        payments.payWithAuthorization(buyer, merchant, amount, orderId, validAfter, validBefore, v, r, s);

        _emitPaid(orderKey, merchant, buyer, orderId, amount);
    }

    // -----------------------------------------------------------------
    // Pay in 4
    // -----------------------------------------------------------------

    /**
     * @notice Open a Pay in 4 plan the buyer signed for, and pay the merchant
     *         the whole principal from the credit pool. Anyone may submit it.
     * @dev Checks, in order: the intent's deadline and window, the buyer's
     *      signature, the buyer's nonce, and that the order is unsettled and
     *      priced as quoted. Then it relays the permit and calls
     *      `PolarisLoanEngine.createLoan`, which enforces the rest: the credit
     *      line from ScoreManager (`ExceedsCreditLimit`), the allowance
     *      covering everything the buyer owes (`InsufficientAllowance`), the
     *      merchant's registry status and cap (`MerchantNotEligible`), the
     *      instalment count and the deployment's minimum interval.
     *
     *      The permit (spender: the loan engine) is submitted inside try/catch
     *      because anyone may submit a permit, and a copy that landed first
     *      must not block the plan. Whether the allowance is then enough is the
     *      engine's check, not the permit's. See `quotePlan` for the value to
     *      sign.
     */
    function openPlan(PlanIntent calldata intent, bytes calldata signature, PermitSignature calldata permit)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 loanId)
    {
        _checkParties(intent.buyer, intent.merchant);
        _checkDeadline(intent.deadline);
        _requireSigned(intent.buyer, _planStructHash(intent), signature);
        _useCheckedNonce(intent.buyer, intent.nonce);

        bytes32 orderKey = _claimOrder(intent.merchant, intent.orderId, intent.principal);
        _record(orderKey, OrderKind.PayIn4, intent.buyer, intent.principal);
        _applyPermit(intent.buyer, address(loanEngine), permit);

        loanId = loanEngine.createLoan(
            intent.buyer,
            intent.merchant,
            intent.principal,
            intent.installments,
            intent.interval
        );
        orders[orderKey].ref = SafeCast.toUint128(loanId);

        _emitPlanOpened(orderKey, intent, loanId);
    }

    // -----------------------------------------------------------------
    // Subscribe
    // -----------------------------------------------------------------

    /**
     * @notice Subscribe the buyer to a merchant's plan and charge the first
     *         period. Anyone may submit it.
     * @dev PolarisPayments trusts this contract to have checked that the plan
     *      is the one the buyer chose, because the buyer's allowance to it is
     *      not tied to any plan. So the plan's merchant, price and period must
     *      equal what the buyer signed, exactly (`PlanMismatch`), and only then
     *      is `subscribeFor` called. A plan's terms never change after it is
     *      published, so matching them here matches them for every renewal.
     *
     *      The permit's spender is PolarisPayments. It replaces the buyer's
     *      allowance there, so an app subscribing a buyer who already has a
     *      subscription signs for all of them together.
     */
    function subscribe(SubscribeIntent calldata intent, bytes calldata signature, PermitSignature calldata permit)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 subId)
    {
        _checkParties(intent.buyer, intent.merchant);
        _checkDeadline(intent.deadline);
        _requireSigned(intent.buyer, _subscribeStructHash(intent), signature);
        _useCheckedNonce(intent.buyer, intent.nonce);

        PolarisPayments.Plan memory plan = payments.getPlan(intent.planId);
        if (
            plan.merchant != intent.merchant ||
            plan.pricePerPeriod != intent.pricePerPeriod ||
            plan.periodSeconds != intent.periodSeconds
        ) revert PlanMismatch(intent.planId);

        bytes32 orderKey = _claimOrder(intent.merchant, intent.orderId, intent.pricePerPeriod);
        _record(orderKey, OrderKind.Subscription, intent.buyer, intent.pricePerPeriod);
        _applyPermit(intent.buyer, address(payments), permit);

        subId = payments.subscribeFor(intent.buyer, intent.planId);
        orders[orderKey].ref = SafeCast.toUint128(subId);

        emit SubscriptionStarted(
            orderKey,
            intent.merchant,
            intent.buyer,
            subId,
            intent.planId,
            intent.orderId,
            intent.pricePerPeriod,
            intent.periodSeconds,
            payments.getSubscription(subId).nextChargeAt
        );
    }

    // -----------------------------------------------------------------
    // Nonces
    // -----------------------------------------------------------------

    /**
     * @notice Retire the caller's next intent without using it.
     * @dev For a buyer who holds gas. One who does not lets the intent's
     *      deadline pass, at most MAX_SIGNATURE_WINDOW away, or signs a newer
     *      intent, which spends the same nonce.
     */
    function invalidateNonce() external returns (uint256 nonce) {
        nonce = _useNonce(msg.sender);
        emit NonceInvalidated(msg.sender, nonce);
    }

    // -----------------------------------------------------------------
    // Views for clients
    // -----------------------------------------------------------------

    /// @notice The key an order is settled under: the PolarisPayments payment
    ///         id, and the ERC-3009 nonce a Pay now authorization signs.
    function orderKeyOf(address merchant, string calldata orderId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(merchant, orderId));
    }

    function orderOf(address merchant, string calldata orderId) external view returns (Order memory) {
        return orders[orderKeyOf(merchant, orderId)];
    }

    /// @notice The EIP-712 digest a buyer signs for `intent`.
    function planIntentDigest(PlanIntent calldata intent) external view returns (bytes32) {
        return _hashTypedDataV4(_planStructHash(intent));
    }

    /// @notice The EIP-712 digest a buyer signs for `intent`.
    function subscribeIntentDigest(SubscribeIntent calldata intent) external view returns (bytes32) {
        return _hashTypedDataV4(_subscribeStructHash(intent));
    }

    /**
     * @notice Price a Pay in 4 plan for `buyer` against their credit line.
     * @dev The interest formula is the loan engine's, read from its public
     *      rate, and the suite holds the two to the same number. The quote
     *      does not validate the instalment count or interval; `openPlan`
     *      refuses what the engine refuses.
     */
    function quotePlan(address buyer, uint256 principal, uint32 installments, uint64 interval)
        external
        view
        returns (PlanQuote memory q)
    {
        uint256 term = uint256(installments) * uint256(interval);
        q.interest = (principal * loanEngine.INTEREST_RATE_BPS() * term) / (10_000 * 365 days);
        q.totalOwed = principal + q.interest;
        q.installmentAmount = installments == 0 ? 0 : (q.totalOwed + installments - 1) / installments;
        q.activeDebt = loanEngine.activeDebtOf(buyer);
        q.permitValue = q.activeDebt + q.totalOwed;
        q.creditLimit = scoreManager.creditLimitOf(buyer);
        q.available = q.creditLimit > q.activeDebt ? q.creditLimit - q.activeDebt : 0;
        q.withinLimit = q.activeDebt + q.totalOwed <= q.creditLimit;
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    function _checkParties(address buyer, address merchant) private pure {
        if (buyer == address(0) || merchant == address(0)) revert ZeroAddress();
    }

    /// Refuse an intent past its deadline, or one that would stay usable for
    /// more than MAX_SIGNATURE_WINDOW from now.
    function _checkDeadline(uint256 deadline) private view {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (deadline > block.timestamp + MAX_SIGNATURE_WINDOW) revert SignatureWindowTooLong();
    }

    /// The buyer's own key first, then ERC-1271 for an account with code. In
    /// that order so an EOA that has since delegated its code (EIP-7702) still
    /// signs with its key, as PolarisSend and AUSD itself accept.
    function _requireSigned(address buyer, bytes32 structHash, bytes calldata signature) private view {
        bytes32 digest = _hashTypedDataV4(structHash);
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecoverCalldata(digest, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == buyer) return;
        if (buyer.code.length != 0 && SignatureChecker.isValidERC1271SignatureNowCalldata(buyer, digest, signature)) {
            return;
        }
        revert InvalidSignature();
    }

    /// An order settles once, in one mode, at its quoted price if it has one.
    /// PolarisPayments is read too, so an order paid there directly (by the
    /// same authorization, or by anyone with `pay`) cannot also become a plan.
    function _claimOrder(address merchant, string calldata orderId, uint256 amount)
        private
        view
        returns (bytes32 orderKey)
    {
        if (bytes(orderId).length == 0) revert EmptyOrderId();
        orderKey = orderKeyOf(merchant, orderId);
        if (orders[orderKey].kind != OrderKind.None) revert OrderAlreadySettled(orderKey);
        (, , , uint64 paidAt) = payments.payments(orderKey);
        if (paidAt != 0) revert OrderAlreadySettled(orderKey);
        uint256 quoted = payments.quotedAmount(merchant, orderKey);
        if (quoted != 0 && quoted != amount) revert WrongAmount(quoted, amount);
    }

    /// Write the order before any external call, so nothing a callee does can
    /// see it unsettled. The caller fills in `ref` once the id exists.
    function _record(bytes32 orderKey, OrderKind kind, address buyer, uint256 amount) private {
        orders[orderKey] = Order({
            kind: kind,
            settledAt: uint64(block.timestamp),
            buyer: buyer,
            amount: SafeCast.toUint128(amount),
            ref: 0
        });
    }

    /// Relay the buyer's permit, if one came. A failure is not fatal: the
    /// permit may already have been submitted by someone else, and the
    /// allowance it set is what the engine or PolarisPayments checks next.
    function _applyPermit(address buyer, address spender, PermitSignature calldata p) private {
        if (p.deadline == 0) return;
        try IERC20Permit(address(stablecoin)).permit(buyer, spender, p.value, p.deadline, p.v, p.r, p.s) {} catch {}
    }

    function _planStructHash(PlanIntent calldata i) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PLAN_INTENT_TYPEHASH,
                i.buyer,
                i.merchant,
                i.principal,
                i.installments,
                i.interval,
                keccak256(bytes(i.orderId)),
                i.nonce,
                i.deadline
            )
        );
    }

    function _subscribeStructHash(SubscribeIntent calldata i) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SUBSCRIBE_INTENT_TYPEHASH,
                i.buyer,
                i.merchant,
                i.planId,
                i.pricePerPeriod,
                i.periodSeconds,
                keccak256(bytes(i.orderId)),
                i.nonce,
                i.deadline
            )
        );
    }

    /// The fee is PolarisPayments' own formula on its current rate, the same
    /// number its PaymentMade event carries in this transaction.
    function _emitPaid(bytes32 orderKey, address merchant, address buyer, string calldata orderId, uint256 amount)
        private
    {
        emit CheckoutPaid(orderKey, merchant, buyer, orderId, amount, (amount * payments.feeBps()) / 10_000);
    }

    function _emitPlanOpened(bytes32 orderKey, PlanIntent calldata intent, uint256 loanId) private {
        PolarisLoanEngine.Loan memory l = loanEngine.getLoan(loanId);
        emit PlanOpened(
            orderKey,
            intent.merchant,
            intent.buyer,
            loanId,
            intent.orderId,
            l.principal,
            l.totalOwed,
            l.installmentCount,
            l.intervalSeconds,
            l.startedAt + l.intervalSeconds
        );
    }
}
