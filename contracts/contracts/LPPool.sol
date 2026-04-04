// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILPPool} from "./interfaces/ILPPool.sol";

contract LPPool is AccessControl, ReentrancyGuard, ILPPool {
    using SafeERC20 for IERC20;

    bytes32 public constant BORROWER_ROLE = keccak256("BORROWER_ROLE");
    bytes32 public constant FEE_DISTRIBUTOR_ROLE = keccak256("FEE_DISTRIBUTOR_ROLE");

    IERC20 public immutable usdc;

    struct MarketPool {
        uint256 totalDeposited; // total assets (idle + borrowed)
        uint256 totalBorrowed;
        uint256 totalShares;
    }

    mapping(bytes32 => MarketPool) public pools;
    mapping(bytes32 => mapping(address => uint256)) public shares;

    // Interest rate model parameters (basis points, 10000 = 100%)
    uint256 public baseRate = 200;         // 2% at 0% utilization
    uint256 public kinkRate = 2000;        // 20% at kink utilization
    uint256 public maxRate = 10000;        // 100% above kink
    uint256 public kinkUtilization = 8000; // 80% utilization kink
    uint256 public maxUtilizationBps = 8500; // 85% max utilization

    uint256 private constant BPS = 10000;
    uint256 private constant SHARE_PRECISION = 1e18;

    event Deposited(address indexed user, bytes32 indexed conditionId, uint256 amount, uint256 sharesIssued);
    event Withdrawn(address indexed user, bytes32 indexed conditionId, uint256 amount, uint256 sharesBurned);

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // --- LP Deposits / Withdrawals ---

    function deposit(bytes32 conditionId, uint256 amount) external nonReentrant {
        MarketPool storage pool = pools[conditionId];
        require(amount > 0, "LPPool: zero amount");

        uint256 newShares;
        if (pool.totalShares == 0) {
            newShares = amount * SHARE_PRECISION / 1e6; // normalize USDC 6-dec to 18-dec shares
        } else {
            newShares = (amount * pool.totalShares) / pool.totalDeposited;
        }
        require(newShares > 0, "LPPool: shares underflow");

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        pool.totalDeposited += amount;
        pool.totalShares += newShares;
        shares[conditionId][msg.sender] += newShares;

        emit Deposited(msg.sender, conditionId, amount, newShares);
    }

    function withdraw(bytes32 conditionId, uint256 shareAmount) external nonReentrant {
        MarketPool storage pool = pools[conditionId];
        require(shareAmount > 0, "LPPool: zero shares");
        require(shares[conditionId][msg.sender] >= shareAmount, "LPPool: insufficient shares");

        uint256 usdcAmount = (shareAmount * pool.totalDeposited) / pool.totalShares;
        uint256 idle = pool.totalDeposited - pool.totalBorrowed;
        require(usdcAmount <= idle, "LPPool: insufficient idle liquidity");

        pool.totalShares -= shareAmount;
        pool.totalDeposited -= usdcAmount;
        shares[conditionId][msg.sender] -= shareAmount;

        usdc.safeTransfer(msg.sender, usdcAmount);

        emit Withdrawn(msg.sender, conditionId, usdcAmount, shareAmount);
    }

    // --- Borrow / Repay (Vault only) ---

    function borrow(bytes32 conditionId, uint256 amount) external onlyRole(BORROWER_ROLE) {
        MarketPool storage pool = pools[conditionId];
        require(amount > 0, "LPPool: zero amount");

        uint256 idle = pool.totalDeposited - pool.totalBorrowed;
        require(amount <= idle, "LPPool: insufficient liquidity");

        uint256 newBorrowed = pool.totalBorrowed + amount;
        require(
            pool.totalDeposited == 0 ||
                (newBorrowed * BPS) / pool.totalDeposited <= maxUtilizationBps,
            "LPPool: utilization cap exceeded"
        );

        pool.totalBorrowed = newBorrowed;
        usdc.safeTransfer(msg.sender, amount);
    }

    function repay(bytes32 conditionId, uint256 amount) external onlyRole(BORROWER_ROLE) {
        MarketPool storage pool = pools[conditionId];
        require(amount > 0, "LPPool: zero amount");
        require(amount <= pool.totalBorrowed, "LPPool: repay exceeds borrowed");

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        pool.totalBorrowed -= amount;
    }

    // --- Fee Distribution ---

    /// @notice Increases totalDeposited without minting shares, raising share price for LPs.
    function addFees(bytes32 conditionId, uint256 amount) external onlyRole(FEE_DISTRIBUTOR_ROLE) {
        require(amount > 0, "LPPool: zero amount");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        pools[conditionId].totalDeposited += amount;
    }

    // --- View Helpers ---

    function getPoolState(bytes32 conditionId)
        external
        view
        returns (
            uint256 totalDeposited,
            uint256 totalBorrowed,
            uint256 availableLiquidity,
            uint256 totalShares
        )
    {
        MarketPool storage pool = pools[conditionId];
        totalDeposited = pool.totalDeposited;
        totalBorrowed = pool.totalBorrowed;
        availableLiquidity = pool.totalDeposited - pool.totalBorrowed;
        totalShares = pool.totalShares;
    }

    function getUserPosition(bytes32 conditionId, address user)
        external
        view
        returns (uint256 userShares, uint256 usdcValue)
    {
        MarketPool storage pool = pools[conditionId];
        userShares = shares[conditionId][user];
        if (pool.totalShares > 0 && userShares > 0) {
            usdcValue = (userShares * pool.totalDeposited) / pool.totalShares;
        }
    }

    function utilizationRate(bytes32 conditionId) public view returns (uint256) {
        MarketPool storage pool = pools[conditionId];
        if (pool.totalDeposited == 0) return 0;
        return (pool.totalBorrowed * BPS) / pool.totalDeposited;
    }

    function currentInterestRate(bytes32 conditionId) public view returns (uint256) {
        uint256 util = utilizationRate(conditionId);

        if (util <= kinkUtilization) {
            return baseRate + ((kinkRate - baseRate) * util) / kinkUtilization;
        }

        return kinkRate
            + ((maxRate - kinkRate) * (util - kinkUtilization))
            / (BPS - kinkUtilization);
    }

    function sharePrice(bytes32 conditionId) external view returns (uint256) {
        MarketPool storage pool = pools[conditionId];
        if (pool.totalShares == 0) return SHARE_PRECISION;
        return (pool.totalDeposited * SHARE_PRECISION) / pool.totalShares;
    }

    // --- Admin ---

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
