// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface ILPPool {
    function deposit(bytes32 conditionId, uint256 amount) external;
    function withdraw(bytes32 conditionId, uint256 shareAmount) external;

    function borrow(bytes32 conditionId, uint256 amount) external;
    function repay(bytes32 conditionId, uint256 amount) external;

    function addFees(bytes32 conditionId, uint256 amount) external;

    function getPoolState(bytes32 conditionId)
        external
        view
        returns (
            uint256 totalDeposited,
            uint256 totalBorrowed,
            uint256 availableLiquidity,
            uint256 totalShares
        );

    function getUserPosition(bytes32 conditionId, address user)
        external
        view
        returns (uint256 userShares, uint256 usdcValue);

    function utilizationRate(bytes32 conditionId) external view returns (uint256);
    function currentInterestRate(bytes32 conditionId) external view returns (uint256);
    function sharePrice(bytes32 conditionId) external view returns (uint256);
}
