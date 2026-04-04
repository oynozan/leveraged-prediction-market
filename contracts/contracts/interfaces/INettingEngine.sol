// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface INettingEngine {
    function getNettingState(bytes32 conditionId)
        external
        view
        returns (uint256 totalYes, uint256 totalNo, uint256 matchedPairs);

    function getCurrentHoldings(bytes32 conditionId)
        external
        view
        returns (uint256 realYesTokens, uint256 realNoTokens);

    function openPosition(address user, bytes32 conditionId, bool isYes, uint256 tokenAmount) external;
    function closePosition(address user, bytes32 conditionId, bool isYes, uint256 tokenAmount) external;

    function recordRebalance(
        bytes32 conditionId,
        int256 yesTokenDelta,
        int256 noTokenDelta,
        bytes32 orderId
    ) external;

    event PositionOpened(address indexed user, bytes32 indexed conditionId, bool isYes, uint256 tokenAmount);
    event PositionClosed(address indexed user, bytes32 indexed conditionId, bool isYes, uint256 tokenAmount);
    event RebalanceExecuted(bytes32 indexed conditionId, int256 yesTokenDelta, int256 noTokenDelta, bytes32 orderId);
}
