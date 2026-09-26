// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IERC3009} from "./interfaces/IERC3009.sol";

/**
 * @title PolarisPayments
 * @notice The two payment modes that are not credit: pay now, and subscribe.
 *
 * @dev Both use the same mechanism as BNPL collection -- the payer grants one
 *      ERC-20 allowance and the protocol draws against it -- because that is
 *      what lets a keeper charge on schedule without the payer being online.
 *      Recurring payments in crypto normally fail on exactly this point: the
 *      only alternative is an unlimited allowance the merchant can drain at
 *      will, which is why almost nobody ships subscriptions on chain.
 *
 *      What makes the allowance safe here is that this contract, not the
 *      merchant, is the spender, and it will only ever move `pricePerPeriod`
 *      and only once per `periodSeconds`. A subscriber can cancel at any time,
 *      and cancelling is unilateral -- it needs no merchant cooperation.
 *
 *      `chargeDue` is permissionless for the same reason `repay` is on the
 *      LoanEngine: funds can only travel subscriber -> merchant on a schedule
 *      the subscriber already agreed to, so a third-party keeper calling it is
 *      harmless and keeps collection decentralised.
 *
 *      On Polaris no buyer or merchant is expected to hold gas, so every
 *      action here also has a form a relayer can submit:
 *        payWithAuthorization  pay an order from an ERC-3009 authorization
 *        subscribeFor          the checkout subscribes a buyer who signed
 *        createPlanFor         an operator publishes a merchant's plan
 *        cancelWithSignature   a subscriber cancels by EIP-712 signature
 *      In each one a signature or a fixed rule, never the caller, decides
 *      whose money moves and where it goes. The relayer carries the
 *      transaction; it can't redirect it.
 */
contract PolarisPayments is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// Protocol fee on every payment, in basis points. 50 = 0.5%.
    uint256 public feeBps = 50;
    uint256 public constant MAX_FEE_BPS = 500;

    IERC20 public immutable stablecoin;
    address public treasury;

    /// Shortest subscription period a deployment may use when none is given.
    uint64 public constant DEFAULT_MIN_PERIOD = 1 hours;
    /// Floor on any configured minimum.
    uint64 public constant MIN_ALLOWED_PERIOD = 60;

    /**
     * @notice Shortest subscription period this deployment accepts.
     * @dev Immutable per deployment, mirroring the loan engine's
     *      `minInterval`: production wants an hour or more, a demo wants a
     *      minute so a renewal can be shown on camera.
     */
    uint64 public immutable minPeriod;

    /// What a subscriber signs to cancel without sending a transaction.
    bytes32 public constant CANCEL_SUBSCRIPTION_TYPEHASH =
        keccak256("CancelSubscription(uint256 subId,uint256 deadline)");

    /**
     * @notice The one contract allowed to subscribe a buyer on their behalf.
     * @dev PolarisCheckout verifies the buyer's signed intent and permit
     *      before it calls `subscribeFor`. This contract trusts it to have
     *      done so, which is why only the owner can appoint it.
     */
    address public checkout;

    /**
     * @notice Accounts that may publish or retire plans for merchants.
     * @dev A merchant onboarded through Polaris for Business holds no MON, so
     *      the relayer creates plans in its name. An operator can only ever
     *      name the merchant as the plan's payee and can only stop new
     *      sign-ups; it can't move anyone's money or touch a live
     *      subscription.
     */
    mapping(address => bool) public isOperator;

    // -----------------------------------------------------------------
    // Direct payments
    // -----------------------------------------------------------------

    struct Payment {
        address payer;
        address merchant;
        uint128 amount;
        uint64 paidAt;
    }

    mapping(bytes32 => Payment) public payments;
    uint256 public paymentCount;

    event PaymentMade(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        uint256 fee,
        string orderId
    );

    // -----------------------------------------------------------------
    // Subscriptions
    // -----------------------------------------------------------------

    enum SubStatus {
        Active,
        Cancelled,
        Lapsed
    }

    struct Plan {
        address merchant;
        uint128 pricePerPeriod;
        uint64 periodSeconds;
        bool active;
        string name;
    }

    struct Subscription {
        address subscriber;
        uint256 planId;
        uint64 startedAt;
        uint64 nextChargeAt;
        uint32 periodsCharged;
        uint32 missedCharges;
        SubStatus status;
    }

    mapping(uint256 => Plan) public plans;
    mapping(uint256 => Subscription) public subscriptions;
    /// One live subscription per (subscriber, plan), so a double-subscribe is
    /// impossible rather than merely discouraged.
    mapping(address => mapping(uint256 => uint256)) public subscriptionOf;

    uint256 public planCount;
    uint256 public subscriptionCount;

    /// How long after the due time a charge may still be collected. Past this
    /// the period is skipped rather than stacked, so a subscriber returning
    /// after a month is not hit with four charges at once.
    uint64 public constant CHARGE_WINDOW = 7 days;
    /// Consecutive misses before a subscription lapses.
    uint32 public constant MAX_MISSES = 3;

    event PlanCreated(uint256 indexed planId, address indexed merchant, uint256 price, uint64 period);
    event PlanDeactivated(uint256 indexed planId);
    event Subscribed(uint256 indexed subId, uint256 indexed planId, address indexed subscriber);
    event SubscriptionCharged(uint256 indexed subId, uint256 amount, uint256 fee, uint32 period);
    event SubscriptionCancelled(uint256 indexed subId, address indexed by);
    event SubscriptionLapsed(uint256 indexed subId, uint32 misses);
    event ChargeMissed(uint256 indexed subId, uint32 misses, string reason);
    event FeeChanged(uint256 bps);
    event CheckoutSet(address indexed checkout);
    event OperatorSet(address indexed operator, bool allowed);

    error ZeroAmount();
    error ZeroAddress();
    error PlanNotActive();
    error AlreadySubscribed();
    error NotSubscriber();
    error SubscriptionNotActive();
    error NotDue();
    error InvalidPeriod();
    error InvalidFee();
    error DuplicatePayment();
    error UnexpectedAmount(uint256 expected, uint256 received);
    error NotCheckout();
    error NotOperator();
    error SignatureExpired();

    constructor(address initialOwner, IERC20 _stablecoin, address _treasury, uint64 _minPeriod)
        Ownable(initialOwner)
        EIP712("PolarisPayments", "1")
    {
        if (_minPeriod != 0 && (_minPeriod < MIN_ALLOWED_PERIOD || _minPeriod > 30 days)) {
            revert InvalidPeriod();
        }
        stablecoin = _stablecoin;
        treasury = _treasury;
        minPeriod = _minPeriod == 0 ? DEFAULT_MIN_PERIOD : _minPeriod;
    }

    function setFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert InvalidFee();
        feeBps = bps;
        emit FeeChanged(bps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    /// @notice Appoint the checkout. The zero address switches relayed
    ///         subscriptions off.
    function setCheckout(address _checkout) external onlyOwner {
        checkout = _checkout;
        emit CheckoutSet(_checkout);
    }

    function setOperator(address operator, bool allowed) external onlyOwner {
        isOperator[operator] = allowed;
        emit OperatorSet(operator, allowed);
    }

    // -----------------------------------------------------------------
    // Direct payment
    // -----------------------------------------------------------------

    /**
     * @notice Pay a merchant in full, now.
     * @dev `orderId` is hashed with the merchant to form the payment id, so a
     *      merchant cannot be paid twice for the same order by a retrying
     *      checkout -- the second call reverts rather than charging again.
     */
    function pay(address merchant, uint256 amount, string calldata orderId)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        paymentId = _recordPayment(msg.sender, merchant, amount, orderId);
        _settle(merchant, msg.sender, amount);
        emit PaymentMade(paymentId, msg.sender, merchant, amount, _fee(amount), orderId);
    }

    /**
     * @notice Pay a merchant from the buyer's signed ERC-3009 authorization,
     *         so a buyer who holds AUSD but no gas pays with a signature and
     *         nothing else. Anyone may submit it; in practice the relayer does.
     *
     * @dev The ERC-3009 nonce is not a parameter. This contract derives it as
     *      the payment id, `keccak256(merchant, orderId)`, exactly as `pay`
     *      does, and hands that to the token. The buyer's signature covers the
     *      nonce, so it commits to this merchant and this order: a relayer
     *      that swaps the merchant changes the nonce and the token rejects the
     *      signature, so it can't redirect the money; one that swaps the order
     *      id is rejected the same way, so one authorization can't pay a
     *      different order.
     *
     *      It calls `receiveWithAuthorization`, not `transferWithAuthorization`,
     *      because the receive variant only runs when the payee is the caller.
     *      An authorization naming this contract can't be lifted from the
     *      mempool and submitted to the token directly, which would move the
     *      money without recording the payment.
     *
     *      The id is shared with `pay`, so an order can't be paid once each
     *      way: whichever lands first records it and the other reverts with
     *      `DuplicatePayment`. A replayed authorization fails the same way,
     *      and would fail again at the token as a spent nonce.
     *
     *      The money lands here and is split by `safeTransfer` with the same
     *      `_fee` that `pay` applies. The balance delta is measured rather than
     *      trusted, so a token that reports success without delivering the
     *      full amount can't mark an order paid.
     */
    function payWithAuthorization(
        address payer,
        address merchant,
        uint256 amount,
        string calldata orderId,
        uint256 validAfter,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (bytes32 paymentId) {
        if (payer == address(0) || merchant == address(0)) revert ZeroAddress();

        paymentId = _recordPayment(payer, merchant, amount, orderId);
        _receiveAuthorized(payer, amount, validAfter, validBefore, paymentId, v, r, s);
        uint256 fee = _payOut(merchant, amount);

        emit PaymentMade(paymentId, payer, merchant, amount, fee, orderId);
    }

    function paymentFor(address merchant, string calldata orderId)
        external
        view
        returns (Payment memory)
    {
        return payments[keccak256(abi.encodePacked(merchant, orderId))];
    }

    // -----------------------------------------------------------------
    // Plans
    // -----------------------------------------------------------------

    function createPlan(uint256 pricePerPeriod, uint64 periodSeconds, string calldata name)
        external
        returns (uint256 planId)
    {
        return _createPlan(msg.sender, pricePerPeriod, periodSeconds, name);
    }

    /**
     * @notice Publish a plan that pays `merchant`, for a merchant who holds no
     *         gas. Owner or operator only.
     * @dev Safe to delegate because a plan moves nothing on its own: money
     *      only flows once a subscriber signs up, and then only to the merchant
     *      named here. The validation is `createPlan`'s, `minPeriod` included.
     */
    function createPlanFor(
        address merchant,
        uint256 pricePerPeriod,
        uint64 periodSeconds,
        string calldata name
    ) external returns (uint256 planId) {
        if (msg.sender != owner() && !isOperator[msg.sender]) revert NotOperator();
        if (merchant == address(0)) revert ZeroAddress();
        return _createPlan(merchant, pricePerPeriod, periodSeconds, name);
    }

    /**
     * @notice Stop new sign-ups to a plan. The plan's merchant can do this,
     *         and so can an operator acting for a merchant who holds no gas.
     * @dev Live subscriptions keep charging: deactivating a plan closes it to
     *      newcomers, it does not cancel anyone.
     */
    function deactivatePlan(uint256 planId) external {
        Plan storage p = plans[planId];
        if (msg.sender != p.merchant && !isOperator[msg.sender]) revert NotSubscriber();
        // An operator must not be able to retire an id that does not exist
        // yet, or an indexer would see a plan retired before it was created.
        if (p.merchant == address(0)) revert PlanNotActive();
        p.active = false;
        emit PlanDeactivated(planId);
    }

    // -----------------------------------------------------------------
    // Subscriptions
    // -----------------------------------------------------------------

    /**
     * @notice Subscribe and pay the first period immediately.
     * @dev Charging period one at subscribe time means a subscription always
     *      starts from a proven-good payment, so a plan can never sit "active"
     *      having never collected anything.
     */
    function subscribe(uint256 planId) external nonReentrant returns (uint256 subId) {
        return _subscribe(msg.sender, planId);
    }

    /**
     * @notice Subscribe `subscriber` on their behalf. Checkout only.
     * @dev `subscribe` takes the subscriber from `msg.sender`, so it can't be
     *      relayed. This is the relayed form: the checkout has already checked
     *      the buyer's signed intent and submitted their permit, and the first
     *      period is drawn from the subscriber's own allowance to this
     *      contract, never from the checkout. Everything else is `subscribe`.
     */
    function subscribeFor(address subscriber, uint256 planId)
        external
        nonReentrant
        returns (uint256 subId)
    {
        if (msg.sender != checkout) revert NotCheckout();
        if (subscriber == address(0)) revert ZeroAddress();
        return _subscribe(subscriber, planId);
    }

    /// @notice True when this subscription is collectable right now.
    function isChargeDue(uint256 subId) public view returns (bool) {
        Subscription storage s = subscriptions[subId];
        if (s.status != SubStatus.Active) return false;
        return block.timestamp >= s.nextChargeAt;
    }

    /**
     * @notice Collect one period. Permissionless -- this is the keeper entry
     *         point, and it is the subscription analogue of `LoanEngine.repay`.
     */
    function chargeDue(uint256 subId) external nonReentrant {
        Subscription storage s = subscriptions[subId];
        if (s.status != SubStatus.Active) revert SubscriptionNotActive();
        if (block.timestamp < s.nextChargeAt) revert NotDue();

        Plan storage p = plans[s.planId];

        // Past the window the period is skipped, not stacked. Advancing to the
        // next boundary rather than adding one period stops a long-absent
        // subscriber from owing a backlog of charges they never consumed.
        if (block.timestamp > s.nextChargeAt + CHARGE_WINDOW) {
            s.missedCharges += 1;
            uint64 periods = (uint64(block.timestamp) - s.nextChargeAt) / p.periodSeconds + 1;
            s.nextChargeAt += periods * p.periodSeconds;
            emit ChargeMissed(subId, s.missedCharges, "charge window elapsed");

            if (s.missedCharges >= MAX_MISSES) {
                s.status = SubStatus.Lapsed;
                emit SubscriptionLapsed(subId, s.missedCharges);
            }
            return;
        }

        _settle(p.merchant, s.subscriber, p.pricePerPeriod);

        s.periodsCharged += 1;
        s.missedCharges = 0;
        s.nextChargeAt += p.periodSeconds;

        emit SubscriptionCharged(subId, p.pricePerPeriod, _fee(p.pricePerPeriod), s.periodsCharged);
    }

    /**
     * @notice Cancel. The subscriber can always do this unilaterally; the
     *         merchant can also cancel, which is how a merchant offboards.
     */
    function cancel(uint256 subId) external {
        Subscription storage s = subscriptions[subId];
        if (s.status != SubStatus.Active) revert SubscriptionNotActive();
        if (msg.sender != s.subscriber && msg.sender != plans[s.planId].merchant) {
            revert NotSubscriber();
        }
        s.status = SubStatus.Cancelled;
        emit SubscriptionCancelled(subId, msg.sender);
    }

    /**
     * @notice Cancel from the subscriber's EIP-712 signature, so a subscriber
     *         who holds no gas can still leave unilaterally. Anyone may submit.
     * @dev The subscriber signs `CancelSubscription(subId, deadline)` under
     *      this contract's domain. Binding `subId` means a signature can never
     *      cancel another subscription, and the domain binds this deployment
     *      and chain. No nonce is needed: cancelling is terminal and a
     *      subscription id is never reused, so a replay finds the
     *      subscription already cancelled. The deadline limits how long a
     *      signature the subscriber chose not to send stays usable.
     */
    function cancelWithSignature(uint256 subId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        if (block.timestamp > deadline) revert SignatureExpired();

        Subscription storage sub = subscriptions[subId];
        if (sub.status != SubStatus.Active) revert SubscriptionNotActive();

        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(CANCEL_SUBSCRIPTION_TYPEHASH, subId, deadline)));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, v, r, s);
        if (err != ECDSA.RecoverError.NoError || signer != sub.subscriber) revert NotSubscriber();

        sub.status = SubStatus.Cancelled;
        emit SubscriptionCancelled(subId, sub.subscriber);
    }

    function getSubscription(uint256 subId) external view returns (Subscription memory) {
        return subscriptions[subId];
    }

    function getPlan(uint256 planId) external view returns (Plan memory) {
        return plans[planId];
    }

    // -----------------------------------------------------------------

    function _fee(uint256 amount) private view returns (uint256) {
        return (amount * feeBps) / 10_000;
    }

    /// Move funds payer -> merchant, net of fee, in one place so direct
    /// payments and subscriptions cannot drift apart on fee handling.
    function _settle(address merchant, address payer, uint256 amount) private {
        uint256 fee = _fee(amount);
        stablecoin.safeTransferFrom(payer, merchant, amount - fee);
        if (fee > 0) {
            stablecoin.safeTransferFrom(payer, treasury, fee);
        }
    }

    /// Claim an order's id and record who paid it, before any token moves.
    /// Both payment paths go through here, which is what makes an order
    /// payable exactly once whichever path lands first.
    function _recordPayment(address payer, address merchant, uint256 amount, string calldata orderId)
        private
        returns (bytes32 paymentId)
    {
        if (amount == 0) revert ZeroAmount();

        paymentId = keccak256(abi.encodePacked(merchant, orderId));
        if (payments[paymentId].paidAt != 0) revert DuplicatePayment();

        payments[paymentId] = Payment({
            payer: payer,
            merchant: merchant,
            amount: uint128(amount),
            paidAt: uint64(block.timestamp)
        });
        paymentCount++;
    }

    /// Pull `amount` from `payer` under their ERC-3009 authorization, with
    /// this contract as the payee, and confirm all of it arrived.
    function _receiveAuthorized(
        address payer,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private {
        uint256 balanceBefore = stablecoin.balanceOf(address(this));
        IERC3009(address(stablecoin)).receiveWithAuthorization(
            payer, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        uint256 received = stablecoin.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert UnexpectedAmount(amount, received);
    }

    /// Split funds this contract already holds: net to the merchant, fee to
    /// the treasury. The same `_fee` as `_settle`, so a signed payment and a
    /// direct one cost the merchant exactly the same.
    function _payOut(address merchant, uint256 amount) private returns (uint256 fee) {
        fee = _fee(amount);
        stablecoin.safeTransfer(merchant, amount - fee);
        if (fee > 0) {
            stablecoin.safeTransfer(treasury, fee);
        }
    }

    function _subscribe(address subscriber, uint256 planId) private returns (uint256 subId) {
        Plan storage p = plans[planId];
        if (!p.active) revert PlanNotActive();

        uint256 existing = subscriptionOf[subscriber][planId];
        if (existing != 0 && subscriptions[existing].status == SubStatus.Active) {
            revert AlreadySubscribed();
        }

        subId = ++subscriptionCount;
        subscriptions[subId] = Subscription({
            subscriber: subscriber,
            planId: planId,
            startedAt: uint64(block.timestamp),
            nextChargeAt: uint64(block.timestamp) + p.periodSeconds,
            periodsCharged: 1,
            missedCharges: 0,
            status: SubStatus.Active
        });
        subscriptionOf[subscriber][planId] = subId;

        _settle(p.merchant, subscriber, p.pricePerPeriod);
        emit Subscribed(subId, planId, subscriber);
        emit SubscriptionCharged(subId, p.pricePerPeriod, _fee(p.pricePerPeriod), 1);
    }

    function _createPlan(
        address merchant,
        uint256 pricePerPeriod,
        uint64 periodSeconds,
        string calldata name
    ) private returns (uint256 planId) {
        if (pricePerPeriod == 0) revert ZeroAmount();
        // A period under the deployment's minimum is almost certainly a
        // mistake, and one over a year makes the allowance a standing risk for
        // no benefit.
        if (periodSeconds < minPeriod || periodSeconds > 365 days) revert InvalidPeriod();

        planId = ++planCount;
        plans[planId] = Plan({
            merchant: merchant,
            pricePerPeriod: uint128(pricePerPeriod),
            periodSeconds: periodSeconds,
            active: true,
            name: name
        });
        emit PlanCreated(planId, merchant, pricePerPeriod, periodSeconds);
    }
}
