// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ICircuitBreaker} from "./interfaces/ICircuitBreaker.sol";
import {INettingEngine} from "./interfaces/INettingEngine.sol";

contract NettingEngine is AccessControl, INettingEngine {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    ICircuitBreaker public circuitBreaker;

    struct NettingState {
        uint256 totalYes;
        uint256 totalNo;
        uint256 matchedPairs;
        uint256 realYesTokens;
        uint256 realNoTokens;
    }

    mapping(bytes32 => NettingState) private _states;

    constructor(address _circuitBreaker) {
        circuitBreaker = ICircuitBreaker(_circuitBreaker);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // View functions
    function getNettingState(bytes32 conditionId)
        external
        view
        returns (uint256 totalYes, uint256 totalNo, uint256 matchedPairs)
    {
        NettingState storage s = _states[conditionId];
        return (s.totalYes, s.totalNo, s.matchedPairs);
    }

    function getCurrentHoldings(bytes32 conditionId)
        external
        view
        returns (uint256 realYesTokens, uint256 realNoTokens)
    {
        NettingState storage s = _states[conditionId];
        return (s.realYesTokens, s.realNoTokens);
    }

    // Position mutations (Server/Operator)
    function openPosition(
        address user,
        bytes32 conditionId,
        bool isYes,
        uint256 tokenAmount
    ) external onlyRole(OPERATOR_ROLE) {
        require(!circuitBreaker.isMarketPaused(conditionId), "NettingEngine: market paused");
        require(tokenAmount > 0, "NettingEngine: zero amount");

        NettingState storage s = _states[conditionId];

        if (isYes) {
            s.totalYes += tokenAmount;
        } else {
            s.totalNo += tokenAmount;
        }

        s.matchedPairs = _min(s.totalYes, s.totalNo);

        emit PositionOpened(user, conditionId, isYes, tokenAmount);
    }

    function closePosition(
        address user,
        bytes32 conditionId,
        bool isYes,
        uint256 tokenAmount
    ) external onlyRole(OPERATOR_ROLE) {
        require(!circuitBreaker.isMarketPaused(conditionId), "NettingEngine: market paused");
        require(tokenAmount > 0, "NettingEngine: zero amount");

        NettingState storage s = _states[conditionId];

        if (isYes) {
            require(tokenAmount <= s.totalYes, "NettingEngine: exceeds total YES");
            s.totalYes -= tokenAmount;
        } else {
            require(tokenAmount <= s.totalNo, "NettingEngine: exceeds total NO");
            s.totalNo -= tokenAmount;
        }

        s.matchedPairs = _min(s.totalYes, s.totalNo);

        emit PositionClosed(user, conditionId, isYes, tokenAmount);
    }

    // Rebalance recording (CRE Rebalancer)
    function recordRebalance(
        bytes32 conditionId,
        int256 yesTokenDelta,
        int256 noTokenDelta,
        bytes32 orderId
    ) external onlyRole(REBALANCER_ROLE) {
        NettingState storage s = _states[conditionId];

        if (yesTokenDelta >= 0) {
            s.realYesTokens += uint256(yesTokenDelta);
        } else {
            uint256 abs = uint256(-yesTokenDelta);
            require(abs <= s.realYesTokens, "NettingEngine: negative YES underflow");
            s.realYesTokens -= abs;
        }

        if (noTokenDelta >= 0) {
            s.realNoTokens += uint256(noTokenDelta);
        } else {
            uint256 abs = uint256(-noTokenDelta);
            require(abs <= s.realNoTokens, "NettingEngine: negative NO underflow");
            s.realNoTokens -= abs;
        }

        emit RebalanceExecuted(conditionId, yesTokenDelta, noTokenDelta, orderId);
    }

    // Admin
    function setCircuitBreaker(address _cb) external onlyRole(DEFAULT_ADMIN_ROLE) {
        circuitBreaker = ICircuitBreaker(_cb);
    }

    // Internal
    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
