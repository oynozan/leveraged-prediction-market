// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IVault} from "./interfaces/IVault.sol";

/// @title RecoveryReceiver
/// @notice CRE-compatible receiver that recovers stuck funds via the Vault.
///         Supports two actions: releasing excess locked margin and repaying stale LP borrows.
///         The KeystoneForwarder calls onReport() after verifying the CRE workflow's signed report.
contract RecoveryReceiver is AccessControl {
    uint8 public constant ACTION_RELEASE_MARGIN = 0;
    uint8 public constant ACTION_REPAY_LP = 1;

    IVault public immutable vault;
    address public forwarder;

    event MarginRecovered(address indexed wallet, uint256 amount);
    event LPRepaid(bytes32 indexed conditionId, uint256 amount);
    event ForwarderUpdated(address indexed newForwarder);

    constructor(address _vault, address _forwarder) {
        require(_vault != address(0), "RecoveryReceiver: zero vault");
        require(_forwarder != address(0), "RecoveryReceiver: zero forwarder");
        vault = IVault(_vault);
        forwarder = _forwarder;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Called by the KeystoneForwarder with a CRE-signed report.
    /// @param report ABI-encoded (uint8 action, bytes data).
    ///        action 0: data = (address wallet, uint256 amount) -> releaseMargin
    ///        action 1: data = (bytes32 conditionId, uint256 amount) -> repayToPool
    function onReport(bytes calldata /* metadata */, bytes calldata report) external {
        require(msg.sender == forwarder, "RecoveryReceiver: unauthorized");
        (uint8 action, bytes memory data) = abi.decode(report, (uint8, bytes));

        if (action == ACTION_RELEASE_MARGIN) {
            (address wallet, uint256 amount) = abi.decode(data, (address, uint256));
            require(wallet != address(0), "RecoveryReceiver: zero wallet");
            require(amount > 0, "RecoveryReceiver: zero amount");
            vault.releaseMargin(wallet, amount);
            emit MarginRecovered(wallet, amount);
        } else if (action == ACTION_REPAY_LP) {
            (bytes32 conditionId, uint256 amount) = abi.decode(data, (bytes32, uint256));
            require(amount > 0, "RecoveryReceiver: zero amount");
            vault.repayToPool(conditionId, amount);
            emit LPRepaid(conditionId, amount);
        } else {
            revert("RecoveryReceiver: unknown action");
        }
    }

    function setForwarder(address _forwarder) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_forwarder != address(0), "RecoveryReceiver: zero address");
        forwarder = _forwarder;
        emit ForwarderUpdated(_forwarder);
    }
}
