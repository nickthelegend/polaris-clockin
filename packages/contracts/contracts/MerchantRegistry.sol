// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MerchantRegistry
 * @notice On-chain merchant directory. The registry entry is the merchant's
 *         identity for settlement and the source of truth the checkout SDK
 *         reads before letting a buyer split a purchase.
 *
 * @dev Merchants register themselves, or the platform registers them, and
 *      either way they are activated by the protocol. Per-merchant caps exist
 *      because BNPL exposure is a function of who is selling as much as who is
 *      buying -- a merchant with a high refund or dispute rate should be able
 *      to originate less, and that lever has to live on chain where the
 *      LoanEngine can see it.
 */
contract MerchantRegistry is Ownable {
    struct Merchant {
        address payoutAddress;
        string name;
        string metadataURI;
        uint128 maxOrderValue;
        uint128 totalSettled;
        uint64 registeredAt;
        bool active;
    }

    /// Conservative default until the protocol raises it; a brand new merchant
    /// should not be able to originate unlimited credit.
    uint128 public constant DEFAULT_MAX_ORDER_VALUE = 500e6;

    mapping(address => Merchant) private _merchants;
    address[] private _merchantList;

    /// Platform accounts allowed to register a merchant on the merchant's
    /// behalf. They can register and nothing else: activation and caps stay
    /// with the owner.
    mapping(address => bool) public isOperator;

    event MerchantRegistered(address indexed merchant, string name, address payoutAddress);
    event MerchantActivated(address indexed merchant, bool active);
    event MerchantUpdated(address indexed merchant, address payoutAddress, uint128 maxOrderValue);
    event SettlementRecorded(address indexed merchant, uint256 amount);
    event OperatorSet(address indexed operator, bool allowed);

    error AlreadyRegistered();
    error NotRegistered();
    error NotMerchantOwner();
    error NotOperator();
    error ZeroAddress();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setOperator(address operator, bool allowed) external onlyOwner {
        isOperator[operator] = allowed;
        emit OperatorSet(operator, allowed);
    }

    /// @notice Register the caller as a merchant. Starts inactive, at the
    ///         default cap.
    function register(
        string calldata name,
        address payoutAddress,
        string calldata metadataURI
    ) external {
        _register(msg.sender, name, payoutAddress, metadataURI);
    }

    /**
     * @notice Register `merchant` on their behalf. Owner or operator only.
     * @dev Merchants sign up with Privy embedded wallets that never hold MON,
     *      so they cannot send `register` themselves; the platform does it for
     *      them. The entry is identical to a self-registration -- inactive, at
     *      the default cap, keyed to the merchant's own address -- so being
     *      onboarded by the platform grants nothing a merchant could not have
     *      given themselves. Only the merchant's own key can change the payout
     *      address afterwards; the operator cannot.
     */
    function registerFor(
        address merchant,
        string calldata name,
        address payoutAddress,
        string calldata metadataURI
    ) external {
        if (msg.sender != owner() && !isOperator[msg.sender]) revert NotOperator();
        // A zero key is an entry nobody can ever sign for, and a merchant list
        // the SDK walks should not contain one.
        if (merchant == address(0)) revert ZeroAddress();
        _register(merchant, name, payoutAddress, metadataURI);
    }

    function _register(
        address merchant,
        string calldata name,
        address payoutAddress,
        string calldata metadataURI
    ) private {
        if (_merchants[merchant].registeredAt != 0) revert AlreadyRegistered();
        _merchants[merchant] = Merchant({
            payoutAddress: payoutAddress,
            name: name,
            metadataURI: metadataURI,
            maxOrderValue: DEFAULT_MAX_ORDER_VALUE,
            totalSettled: 0,
            registeredAt: uint64(block.timestamp),
            active: false
        });
        _merchantList.push(merchant);
        emit MerchantRegistered(merchant, name, payoutAddress);
    }

    function setActive(address merchant, bool active) external onlyOwner {
        if (_merchants[merchant].registeredAt == 0) revert NotRegistered();
        _merchants[merchant].active = active;
        emit MerchantActivated(merchant, active);
    }

    function setMaxOrderValue(address merchant, uint128 maxOrderValue) external onlyOwner {
        if (_merchants[merchant].registeredAt == 0) revert NotRegistered();
        _merchants[merchant].maxOrderValue = maxOrderValue;
        emit MerchantUpdated(merchant, _merchants[merchant].payoutAddress, maxOrderValue);
    }

    function updatePayoutAddress(address payoutAddress) external {
        Merchant storage m = _merchants[msg.sender];
        if (m.registeredAt == 0) revert NotRegistered();
        m.payoutAddress = payoutAddress;
        emit MerchantUpdated(msg.sender, payoutAddress, m.maxOrderValue);
    }

    function recordSettlement(address merchant, uint256 amount) external onlyOwner {
        _merchants[merchant].totalSettled += uint128(amount);
        emit SettlementRecorded(merchant, amount);
    }

    function merchantOf(address merchant) external view returns (Merchant memory) {
        return _merchants[merchant];
    }

    /// @notice Whether this merchant may originate a plan of this size.
    function canOriginate(address merchant, uint256 orderValue) external view returns (bool) {
        Merchant storage m = _merchants[merchant];
        return m.active && orderValue <= m.maxOrderValue;
    }

    function merchantCount() external view returns (uint256) {
        return _merchantList.length;
    }

    function merchantAt(uint256 index) external view returns (address) {
        return _merchantList[index];
    }
}
