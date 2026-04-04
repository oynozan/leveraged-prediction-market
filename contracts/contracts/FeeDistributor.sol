// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ILPPool} from "./interfaces/ILPPool.sol";

contract FeeDistributor is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    IERC20 public immutable usdc;
    ILPPool public immutable lpPool;

    mapping(bytes32 => uint256) private _pendingFees;

    event FeeCollected(address indexed from, bytes32 indexed conditionId, uint256 amount);
    event FeesDistributed(bytes32 indexed conditionId, uint256 amount);

    constructor(address _usdc, address _lpPool) {
        usdc = IERC20(_usdc);
        lpPool = ILPPool(_lpPool);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function collectFee(bytes32 conditionId, uint256 amount) external onlyRole(VAULT_ROLE) {
        require(amount > 0, "FeeDistributor: zero amount");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _pendingFees[conditionId] += amount;
        emit FeeCollected(msg.sender, conditionId, amount);
    }

    /// @notice Sends pending fees for a market to the LP Pool via addFees(),
    ///         raising share price for that market's LPs. Callable by anyone.
    function distribute(bytes32 conditionId) external {
        uint256 amount = _pendingFees[conditionId];
        require(amount > 0, "FeeDistributor: nothing to distribute");

        _pendingFees[conditionId] = 0;
        usdc.approve(address(lpPool), amount);
        lpPool.addFees(conditionId, amount);

        emit FeesDistributed(conditionId, amount);
    }

    function pendingFees(bytes32 conditionId) external view returns (uint256) {
        return _pendingFees[conditionId];
    }
}
