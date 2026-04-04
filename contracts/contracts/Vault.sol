// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ILPPool} from "./interfaces/ILPPool.sol";
import {ICircuitBreaker} from "./interfaces/ICircuitBreaker.sol";
import {IVault} from "./interfaces/IVault.sol";

/// @dev Minimal interface for Uniswap V3 SwapRouter.exactInputSingle
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @dev Minimal WETH interface for deposit/withdraw
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
}

contract Vault is AccessControl, ReentrancyGuard, Pausable, IVault {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");

    IERC20 public immutable usdc;
    ILPPool public immutable lpPool;
    ISwapRouter public immutable swapRouter;
    IWETH public immutable weth;
    ICircuitBreaker public circuitBreaker;

    struct MarginAccount {
        uint256 total;
        uint256 locked;
    }

    mapping(address => MarginAccount) public margins;
    mapping(bytes32 => bool) public processedMessages;

    event MarginDeposited(address indexed user, uint256 amount);
    event MarginWithdrawn(address indexed user, uint256 amount);
    event MarginLocked(address indexed user, uint256 amount);
    event MarginReleased(address indexed user, uint256 amount);
    event SwapDeposit(address indexed user, address indexed tokenIn, uint256 amountIn, uint256 usdcReceived);

    constructor(
        address _usdc,
        address _lpPool,
        address _swapRouter,
        address _weth,
        address _circuitBreaker
    ) {
        usdc = IERC20(_usdc);
        lpPool = ILPPool(_lpPool);
        swapRouter = ISwapRouter(_swapRouter);
        weth = IWETH(_weth);
        circuitBreaker = ICircuitBreaker(_circuitBreaker);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // Margin Management
    function depositMargin(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Vault: zero amount");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        margins[msg.sender].total += amount;
        emit MarginDeposited(msg.sender, amount);
    }

    function depositWithSwap(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint24 poolFee
    ) external whenNotPaused nonReentrant {
        require(amountIn > 0, "Vault: zero amount");
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 usdcReceived = _swap(tokenIn, amountIn, amountOutMinimum, poolFee);
        margins[msg.sender].total += usdcReceived;

        emit SwapDeposit(msg.sender, tokenIn, amountIn, usdcReceived);
    }

    function depositETHWithSwap(
        uint256 amountOutMinimum,
        uint24 poolFee
    ) external payable whenNotPaused nonReentrant {
        require(msg.value > 0, "Vault: zero ETH");

        weth.deposit{value: msg.value}();

        uint256 usdcReceived = _swap(address(weth), msg.value, amountOutMinimum, poolFee);
        margins[msg.sender].total += usdcReceived;

        emit SwapDeposit(msg.sender, address(weth), msg.value, usdcReceived);
    }

    function withdrawMargin(uint256 amount) external whenNotPaused nonReentrant {
        MarginAccount storage acc = margins[msg.sender];
        uint256 available = acc.total - acc.locked;
        require(amount > 0 && amount <= available, "Vault: insufficient available margin");

        acc.total -= amount;
        usdc.safeTransfer(msg.sender, amount);

        emit MarginWithdrawn(msg.sender, amount);
    }

    // Platform Operations (Operator)
    function lockMargin(address user, uint256 amount) external onlyRole(OPERATOR_ROLE) {
        MarginAccount storage acc = margins[user];
        uint256 available = acc.total - acc.locked;
        require(amount > 0 && amount <= available, "Vault: insufficient available margin");
        acc.locked += amount;
        emit MarginLocked(user, amount);
    }

    function releaseMargin(address user, uint256 amount) external onlyRole(OPERATOR_ROLE) {
        MarginAccount storage acc = margins[user];
        require(amount > 0 && amount <= acc.locked, "Vault: insufficient locked margin");
        acc.locked -= amount;
        emit MarginReleased(user, amount);
    }

    function borrowFromPool(uint256 amount) external onlyRole(OPERATOR_ROLE) {
        lpPool.borrow(amount);
    }

    function repayToPool(uint256 amount) external onlyRole(OPERATOR_ROLE) {
        usdc.approve(address(lpPool), amount);
        lpPool.repay(amount);
    }

    // CCIP Compatibility (Bridge)
    function creditBalance(
        address user,
        uint256 amount,
        uint64 sourceChain,
        bytes32 ccipMessageId
    ) external onlyRole(BRIDGE_ROLE) {
        require(!processedMessages[ccipMessageId], "Vault: message already processed");
        processedMessages[ccipMessageId] = true;

        margins[user].total += amount;

        emit CCIPDepositReceived(ccipMessageId, sourceChain, user, amount);
    }

    // Uniswap Swap (internal)
    function _swap(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint24 fee
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).approve(address(swapRouter), amountIn);

        amountOut = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: address(usdc),
                fee: fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );
    }

    // Admin
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setCircuitBreaker(address _cb) external onlyRole(DEFAULT_ADMIN_ROLE) {
        circuitBreaker = ICircuitBreaker(_cb);
    }

    function emergencyWithdraw(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    // Receive native token
    receive() external payable {}

    // View
    function getMargin(address user) external view returns (uint256 total, uint256 locked, uint256 available) {
        MarginAccount storage acc = margins[user];
        total = acc.total;
        locked = acc.locked;
        available = acc.total - acc.locked;
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
