// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ICircuitBreaker} from "./interfaces/ICircuitBreaker.sol";

contract CircuitBreaker is AccessControl, ICircuitBreaker {
    bytes32 public constant CIRCUIT_BREAKER_ROLE = keccak256("CIRCUIT_BREAKER_ROLE");

    mapping(bytes32 => bool) public marketPaused;
    mapping(bytes32 => uint256) public lastPauseTimestamp;
    bool public globalPause;

    event MarketPaused(bytes32 indexed conditionId, uint256 priceChangeBps);
    event MarketUnpaused(bytes32 indexed conditionId);
    event GlobalPauseSet(bool paused);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function processPauseCommand(
        bytes32 conditionId,
        uint256 priceChangeBps,
        bool shouldPause
    ) external onlyRole(CIRCUIT_BREAKER_ROLE) {
        if (shouldPause && !marketPaused[conditionId]) {
            marketPaused[conditionId] = true;
            lastPauseTimestamp[conditionId] = block.timestamp;
            emit MarketPaused(conditionId, priceChangeBps);
        } else if (!shouldPause && marketPaused[conditionId]) {
            marketPaused[conditionId] = false;
            emit MarketUnpaused(conditionId);
        }
    }

    function isMarketPaused(bytes32 conditionId) external view returns (bool) {
        return globalPause || marketPaused[conditionId];
    }

    function setGlobalPause(bool paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        globalPause = paused;
        emit GlobalPauseSet(paused);
    }
}
