// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
contract FeeDistributor is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    IERC20 public immutable usdc;
    address public immutable lpPool;

    event FeeCollected(address indexed from, uint256 amount);
    event FeesDistributed(uint256 amount);

    constructor(address _usdc, address _lpPool) {
        usdc = IERC20(_usdc);
        lpPool = _lpPool;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function collectFee(uint256 amount) external onlyRole(VAULT_ROLE) {
        require(amount > 0, "FeeDistributor: zero amount");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit FeeCollected(msg.sender, amount);
    }

    /// @notice Transfers all accumulated USDC directly to the LP Pool.
    ///         Because no new shares are minted, the pool's totalAssets()
    ///         increases while totalSupply stays constant,  share price
    ///         rises for all existing LP holders.
    ///         Callable by anyone (permissionless distribution).
    function distribute() external {
        uint256 balance = pendingFees();
        require(balance > 0, "FeeDistributor: nothing to distribute");

        usdc.safeTransfer(lpPool, balance);

        emit FeesDistributed(balance);
    }

    function pendingFees() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
