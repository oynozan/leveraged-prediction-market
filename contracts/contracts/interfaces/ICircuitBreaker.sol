// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface ICircuitBreaker {
    function isMarketPaused(bytes32 conditionId) external view returns (bool);
    function processPauseCommand(bytes32 conditionId, uint256 priceChangeBps, bool shouldPause) external;
    function setGlobalPause(bool paused) external;
}
