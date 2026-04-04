// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILPPool} from "./interfaces/ILPPool.sol";

contract LPPool is ERC4626, AccessControl, ILPPool {
    using SafeERC20 for IERC20;
    using Math for uint256;

    bytes32 public constant BORROWER_ROLE = keccak256("BORROWER_ROLE");

    uint256 private _totalBorrowed;

    // Interest rate model parameters (basis points, 10000 = 100%)
    uint256 public baseRate = 200;        // 2% at 0% utilization
    uint256 public kinkRate = 2000;       // 20% at kink utilization
    uint256 public maxRate = 10000;       // 100% above kink
    uint256 public kinkUtilization = 8000; // 80% utilization kink

    uint256 public maxUtilizationBps = 8500; // 85% max utilization

    uint256 private constant BPS = 10000;

    constructor(
        IERC20 usdc
    ) ERC4626(usdc) ERC20("PredLev LP Token", "plLP") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ERC-4626 override
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + _totalBorrowed;
    }

    // Borrow / Repay (Vault only)
    function borrow(uint256 amount) external onlyRole(BORROWER_ROLE) {
        require(amount > 0, "LPPool: zero amount");

        uint256 available = availableLiquidity();
        require(amount <= available, "LPPool: insufficient liquidity");

        uint256 newBorrowed = _totalBorrowed + amount;
        uint256 total = totalAssets();
        require(
            total == 0 || (newBorrowed * BPS) / total <= maxUtilizationBps,
            "LPPool: utilization cap exceeded"
        );

        _totalBorrowed = newBorrowed;
        IERC20(asset()).safeTransfer(msg.sender, amount);
    }

    function repay(uint256 amount) external onlyRole(BORROWER_ROLE) {
        require(amount > 0, "LPPool: zero amount");
        require(amount <= _totalBorrowed, "LPPool: repay exceeds borrowed");

        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        _totalBorrowed -= amount;
    }

    // View helpers
    function totalBorrowed() external view returns (uint256) {
        return _totalBorrowed;
    }

    function availableLiquidity() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @return Utilization in basis points (0–10000)
    function utilizationRate() public view returns (uint256) {
        uint256 total = totalAssets();
        if (total == 0) return 0;
        return (_totalBorrowed * BPS) / total;
    }

    /// @return Annual interest rate in basis points using a two-slope model
    function currentInterestRate() public view returns (uint256) {
        uint256 util = utilizationRate();

        if (util <= kinkUtilization) {
            return baseRate + ((kinkRate - baseRate) * util) / kinkUtilization;
        }

        return kinkRate
            + ((maxRate - kinkRate) * (util - kinkUtilization))
            / (BPS - kinkUtilization);
    }

    // Admin
    function setInterestRateParams(
        uint256 _baseRate,
        uint256 _kinkRate,
        uint256 _maxRate,
        uint256 _kinkUtilization
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_baseRate <= _kinkRate && _kinkRate <= _maxRate, "LPPool: invalid rate params");
        require(_kinkUtilization > 0 && _kinkUtilization < BPS, "LPPool: invalid kink");
        baseRate = _baseRate;
        kinkRate = _kinkRate;
        maxRate = _maxRate;
        kinkUtilization = _kinkUtilization;
    }

    function setMaxUtilization(uint256 _maxBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_maxBps > 0 && _maxBps <= BPS, "LPPool: invalid max util");
        maxUtilizationBps = _maxBps;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
