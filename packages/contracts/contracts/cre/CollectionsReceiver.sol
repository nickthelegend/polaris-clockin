// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";

/// The loan engine calls this receiver makes. All are permissionless there.
interface ICollectableLoans {
    function collectInstallment(uint256 loanId) external returns (uint256 collected);
    function liquidate(uint256 loanId) external;
    function isInstallmentDue(uint256 loanId) external view returns (bool);
    function checkLiquidatable(uint256 loanId) external view returns (bool);
}

/// The PolarisPayments calls this receiver makes. Both are permissionless there.
interface IChargeableSubscriptions {
    function chargeDue(uint256 subId) external;
    function isChargeDue(uint256 subId) external view returns (bool);
}

/**
 * @title CollectionsReceiver
 * @notice Receives the Chainlink CRE `polaris-collections` workflow's signed
 *         report and executes it: collect the instalments that fell due,
 *         charge the subscriptions that renewed, liquidate the plans past
 *         grace. The indexer proposes, the chain disposes.
 *
 * @dev The workflow runs on a cron (every minute). It reads candidate ids from
 *      the Envio indexer, asks `checkTasks` which of them are actionable at the
 *      last finalized block, reaches consensus across the DON, and writes one
 *      report through the KeystoneForwarder. `onReport` (ReceiverTemplate)
 *      accepts it only from the configured forwarder and, once set, only from
 *      the expected workflow owner and name.
 *
 *      Report body (after the forwarder strips the 109-byte header):
 *        abi.encode(uint8 kind, Task[] tasks)   kind == REPORT_KIND (1)
 *        Task = (uint8 action, uint256 id)
 *        action 1 = PolarisLoanEngine.collectInstallment(id)
 *        action 2 = PolarisPayments.chargeDue(id)
 *        action 3 = PolarisLoanEngine.liquidate(id)
 *
 *      Every action is permissionless on its target, because the schedule the
 *      buyer signed, not the caller, decides what moves. So this receiver adds
 *      no power: it is the DON's way of calling what anyone may call, and a
 *      forged report can do nothing a stranger could not. That is why it
 *      needs no simulation-only guard while it trusts the permissionless
 *      MockKeystoneForwarder, unlike UnderwritingReceiver.
 *
 *      Each task runs in its own try/catch. A task that reverts is skipped with
 *      its revert data in `TaskSkipped`, and the rest of the batch still runs.
 *      Those reasons feed the dunning ladder: the engine reports
 *      `InsufficientAllowance(have, need)` and `InsufficientBalance(have, need)`
 *      as distinct errors, so "sign again" and "top up" are never confused, and
 *      `NotDue` / `LoanNotActive` say a candidate was stale, which is nobody's
 *      fault. Under `cre workflow simulate` a reverted `onReport` still reads as
 *      success, so these events are also the only reliable record of what a
 *      run did.
 *
 *      One failure is not the task's: the report running out of gas. A callee
 *      that exhausts its gas leaves this frame at most 1/64 of what it had, and
 *      recording that as a skip would dun a buyer for our gas limit. So when a
 *      task fails with (almost) no gas left, the whole report reverts with
 *      `InsufficientGasForTask`, and the KeystoneForwarder may retry the
 *      transmission with a higher limit.
 */
contract CollectionsReceiver is ReceiverTemplate {
    uint8 public constant REPORT_KIND = 1;

    uint8 public constant ACTION_COLLECT_INSTALLMENT = 1;
    uint8 public constant ACTION_CHARGE_SUBSCRIPTION = 2;
    uint8 public constant ACTION_LIQUIDATE = 3;

    struct Task {
        uint8 action;
        uint256 id;
    }

    ICollectableLoans public immutable loanEngine;
    IChargeableSubscriptions public immutable payments;

    /// A task succeeded. `amount` is what an instalment collection delivered,
    /// and zero for the other actions (their own events carry the amounts).
    event TaskExecuted(uint8 indexed action, uint256 indexed id, uint256 amount);
    /// A task reverted and was skipped. `reason` is the target's revert data.
    event TaskSkipped(uint8 indexed action, uint256 indexed id, bytes reason);
    /// One report processed.
    event CollectionsRun(uint256 tasks, uint256 executed, uint256 skipped);

    error UnknownReportKind(uint8 kind);
    error UnknownAction(uint8 action);
    error InsufficientGasForTask(uint256 index);
    error ZeroAddress();

    constructor(address forwarder, ICollectableLoans _loanEngine, IChargeableSubscriptions _payments)
        ReceiverTemplate(forwarder)
    {
        if (address(_loanEngine) == address(0) || address(_payments) == address(0)) revert ZeroAddress();
        loanEngine = _loanEngine;
        payments = _payments;
    }

    /**
     * @notice Which candidate tasks are actionable right now.
     * @dev The workflow's one EVM read per run. A purpose-built view rather
     *      than Multicall3, because CRE caps a read request at 5 KB: Multicall3
     *      fits about 20 checks, this about 150 ids. An unknown action reads as
     *      not ready.
     */
    function checkTasks(Task[] calldata tasks) external view returns (bool[] memory ready) {
        ready = new bool[](tasks.length);
        for (uint256 i; i < tasks.length; ++i) {
            uint8 action = tasks[i].action;
            uint256 id = tasks[i].id;
            if (action == ACTION_COLLECT_INSTALLMENT) {
                ready[i] = loanEngine.isInstallmentDue(id);
            } else if (action == ACTION_CHARGE_SUBSCRIPTION) {
                ready[i] = payments.isChargeDue(id);
            } else if (action == ACTION_LIQUIDATE) {
                ready[i] = loanEngine.checkLiquidatable(id);
            }
        }
    }

    function _processReport(bytes calldata report) internal override {
        (uint8 kind, Task[] memory tasks) = abi.decode(report, (uint8, Task[]));
        if (kind != REPORT_KIND) revert UnknownReportKind(kind);

        uint256 executed;
        for (uint256 i; i < tasks.length; ++i) {
            if (_run(i, tasks[i])) ++executed;
        }
        emit CollectionsRun(tasks.length, executed, tasks.length - executed);
    }

    /// Run one task in isolation. Returns whether it executed.
    function _run(uint256 index, Task memory t) private returns (bool) {
        uint256 gasBefore = gasleft();
        bytes memory reason;
        if (t.action == ACTION_COLLECT_INSTALLMENT) {
            try loanEngine.collectInstallment(t.id) returns (uint256 collected) {
                emit TaskExecuted(t.action, t.id, collected);
                return true;
            } catch (bytes memory r) {
                reason = r;
            }
        } else if (t.action == ACTION_CHARGE_SUBSCRIPTION) {
            try payments.chargeDue(t.id) {
                emit TaskExecuted(t.action, t.id, 0);
                return true;
            } catch (bytes memory r) {
                reason = r;
            }
        } else if (t.action == ACTION_LIQUIDATE) {
            try loanEngine.liquidate(t.id) {
                emit TaskExecuted(t.action, t.id, 0);
                return true;
            } catch (bytes memory r) {
                reason = r;
            }
        } else {
            emit TaskSkipped(t.action, t.id, abi.encodeWithSelector(UnknownAction.selector, t.action));
            return false;
        }
        // Out of gas inside the call leaves at most gasBefore/64 here. That is
        // the report's limit failing, not the task: refuse the whole report
        // so it can be retried with more gas.
        if (gasleft() <= gasBefore / 63) revert InsufficientGasForTask(index);
        emit TaskSkipped(t.action, t.id, reason);
        return false;
    }
}
