// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface ILPPool {
    function borrow(uint256 amount) external;
    function repay(uint256 amount) external;

    function totalBorrowed() external view returns (uint256);
    function availableLiquidity() external view returns (uint256);
    function utilizationRate() external view returns (uint256);
    function currentInterestRate() external view returns (uint256);
}
