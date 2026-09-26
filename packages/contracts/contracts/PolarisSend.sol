// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IERC3009} from "./interfaces/IERC3009.sol";

/**
 * @title PolarisSend
 * @notice Send dollars across borders as a link. The sender signs once, a
 *         relayer escrows the money here, and whoever opens the link claims it
 *         to any address. Neither side ever holds gas.
 *
 * @dev The link is a URL whose fragment (`#k=...`) carries a throwaway private
 *      key. Browsers never send the fragment to a server, so the key travels
 *      only from the sender to the recipient. The key's address, the "link
 *      key", is what the escrow is filed under, and holding the key is what
 *      entitles someone to the money.
 *
 *      No entry point reads `msg.sender`, so a relayer can submit every one of
 *      them. What keeps the relayer honest is that each signature commits to
 *      where the money goes:
 *        send    the sender's ERC-3009 authorization commits to the link key
 *                and the expiry, through a nonce this contract derives.
 *        claim   the link key signs the recipient's address.
 *        cancel  the sender signs the link key being cancelled.
 *        refund  needs no signature, because it can only ever pay the sender.
 *
 *      A link key funds exactly one link, ever. That one rule is what makes
 *      every claim and cancel signature single-use without a nonce of its own:
 *      once a link is gone, nothing can be filed under its key again, so an old
 *      signature has nothing left to act on.
 *
 *      A front-runner who copies a link key into a send of its own can only
 *      block that key. The money it escrows is claimable by whoever holds the
 *      key, the sender's authorization is left unused, and the app retries
 *      with a fresh key.
 */
contract PolarisSend is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Longest a link may stay open. Past this, unclaimed money sits in escrow
    /// for no one's benefit, and a forgotten link stays a live bearer claim.
    uint64 public constant MAX_EXPIRY = 30 days;
    /// Shortest a link may live. Anything shorter could expire while the
    /// recipient's claim is still on its way to the chain.
    uint64 public constant MIN_LIFETIME = 5 minutes;

    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(address to)");
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(address linkKey,uint256 deadline)");

    struct Link {
        address sender;
        uint128 amount;
        uint64 expiresAt;
    }

    IERC20 public immutable stablecoin;

    /// Open links by link key. A link that is claimed, cancelled or refunded
    /// is deleted, so a zero `sender` means there is nothing to pay out.
    mapping(address => Link) public links;
    /// Every link key that has ever funded a link. Never cleared.
    mapping(address => bool) public keyUsed;

    event Sent(address indexed linkKey, address indexed sender, uint256 amount, uint64 expiresAt);
    event Claimed(address indexed linkKey, address indexed to, uint256 amount);
    event Cancelled(address indexed linkKey, address indexed sender, uint256 amount);
    event Refunded(address indexed linkKey, address indexed sender, uint256 amount);

    error ZeroAddress();
    error LinkKeyUsed();
    error InvalidAmount();
    error InvalidExpiry();
    error UnexpectedAmount(uint256 expected, uint256 received);
    error LinkNotFound();
    error LinkExpired();
    error NotExpired();
    error InvalidClaimSignature();
    error SignatureExpired();
    error NotSender();

    constructor(IERC20 _stablecoin) EIP712("PolarisSend", "1") {
        if (address(_stablecoin) == address(0)) revert ZeroAddress();
        stablecoin = _stablecoin;
    }

    // -----------------------------------------------------------------
    // Send
    // -----------------------------------------------------------------

    /**
     * @notice Escrow `amount` from `sender` against `linkKey` until
     *         `expiresAt`. Anyone may submit it; the sender's ERC-3009
     *         `ReceiveWithAuthorization` is what pays for it.
     * @dev The ERC-3009 nonce is not taken from the caller. This contract
     *      derives it as keccak256(abi.encode(linkKey, expiresAt)), so the
     *      sender's signature commits to this link key and this expiry. A
     *      relayer that swaps in a key it controls, to claim the money itself,
     *      changes the nonce, and the token rejects the signature. The token
     *      also requires its caller to be the payee, so the authorization
     *      cannot be spent anywhere but here.
     *
     *      `validAfter` and `validBefore` pass straight through to the token.
     *      They bound when the authorization may be used, not how long the
     *      link lives; that is `expiresAt`.
     */
    function send(
        address sender,
        address linkKey,
        uint256 amount,
        uint64 expiresAt,
        uint256 validAfter,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        if (linkKey == address(0) || sender == address(0)) revert ZeroAddress();
        if (keyUsed[linkKey]) revert LinkKeyUsed();
        if (amount == 0 || amount > type(uint128).max) revert InvalidAmount();
        if (expiresAt < block.timestamp + MIN_LIFETIME || expiresAt > block.timestamp + MAX_EXPIRY) {
            revert InvalidExpiry();
        }

        keyUsed[linkKey] = true;
        links[linkKey] = Link({sender: sender, amount: uint128(amount), expiresAt: expiresAt});

        uint256 received =
            _pull(sender, amount, validAfter, validBefore, sendNonce(linkKey, expiresAt), v, r, s);
        if (received != amount) revert UnexpectedAmount(amount, received);

        emit Sent(linkKey, sender, amount, expiresAt);
    }

    // -----------------------------------------------------------------
    // Claim
    // -----------------------------------------------------------------

    /**
     * @notice Pay the link out to `to`. Anyone may submit it; the link key's
     *         signature is what authorizes it.
     * @dev The link key signs `Claim(address to)`, so the recipient is part of
     *      what was signed. Someone watching the mempool can copy the signature
     *      but not change where the money goes: with any other `to` it recovers
     *      to a different address and is refused. The link key itself is not in
     *      the message because the signer is the link key.
     */
    function claim(address linkKey, address to, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        Link memory link = links[linkKey];
        if (link.sender == address(0)) revert LinkNotFound();
        if (block.timestamp >= link.expiresAt) revert LinkExpired();
        if (to == address(0)) revert ZeroAddress();
        // `linkKey` is never zero for an open link, so a signature that fails
        // to recover (and yields the zero address) can never match it.
        if (_recover(claimDigest(to), v, r, s) != linkKey) revert InvalidClaimSignature();

        delete links[linkKey];
        stablecoin.safeTransfer(to, link.amount);

        emit Claimed(linkKey, to, link.amount);
    }

    // -----------------------------------------------------------------
    // Cancel and refund
    // -----------------------------------------------------------------

    /**
     * @notice Take back an unclaimed link. The sender signs; anyone submits.
     * @dev The sender signs `Cancel(address linkKey,uint256 deadline)`, so a
     *      cancel for one link cannot be replayed against another, and the
     *      money can only go back to the sender recorded at send time. The
     *      deadline limits how long a signed cancel can sit unused. It is
     *      accepted after expiry too: the money goes to the same place a
     *      refund would send it.
     */
    function cancel(address linkKey, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        Link memory link = links[linkKey];
        if (link.sender == address(0)) revert LinkNotFound();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (_recover(cancelDigest(linkKey, deadline), v, r, s) != link.sender) revert NotSender();

        delete links[linkKey];
        stablecoin.safeTransfer(link.sender, link.amount);

        emit Cancelled(linkKey, link.sender, link.amount);
    }

    /**
     * @notice Return an expired link to its sender. Anyone may call it.
     * @dev Permissionless for the same reason `chargeDue` is on
     *      PolarisPayments: the money can only travel to the sender, so a
     *      stranger calling it is harmless, and the sender does not have to be
     *      online, or hold gas, to get their money back.
     */
    function refund(address linkKey) external nonReentrant {
        Link memory link = links[linkKey];
        if (link.sender == address(0)) revert LinkNotFound();
        if (block.timestamp < link.expiresAt) revert NotExpired();

        delete links[linkKey];
        stablecoin.safeTransfer(link.sender, link.amount);

        emit Refunded(linkKey, link.sender, link.amount);
    }

    // -----------------------------------------------------------------
    // Views for clients
    // -----------------------------------------------------------------

    function linkOf(address linkKey) external view returns (Link memory) {
        return links[linkKey];
    }

    /// @notice The digest the link key signs to claim to `to`.
    function claimDigest(address to) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, to)));
    }

    /// @notice The digest the sender signs to cancel `linkKey`.
    function cancelDigest(address linkKey, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, linkKey, deadline)));
    }

    /**
     * @notice The ERC-3009 nonce a sender must sign for this link.
     * @dev Exposed so the app derives the nonce from the same code that checks
     *      it, rather than from a copy that could drift.
     */
    function sendNonce(address linkKey, uint64 expiresAt) public pure returns (bytes32) {
        return keccak256(abi.encode(linkKey, expiresAt));
    }

    // -----------------------------------------------------------------

    /// Pull the sender's authorized amount and return what actually arrived,
    /// measured rather than assumed, so a token that delivers less than it
    /// was asked to cannot leave a link promising more than the escrow holds.
    function _pull(
        address sender,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private returns (uint256) {
        uint256 balanceBefore = stablecoin.balanceOf(address(this));
        IERC3009(address(stablecoin)).receiveWithAuthorization(
            sender, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        return stablecoin.balanceOf(address(this)) - balanceBefore;
    }

    /// Recover a signer without reverting, so a malformed signature is refused
    /// with this contract's own error rather than the library's.
    function _recover(bytes32 digest, uint8 v, bytes32 r, bytes32 s) private pure returns (address signer) {
        (signer,,) = ECDSA.tryRecover(digest, v, r, s);
    }
}
