// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IVault {
    function depositMargin(uint256 amount) external;
    function depositWithSwap(address tokenIn, uint256 amountIn, uint256 amountOutMinimum, uint24 poolFee) external;
    function depositETHWithSwap(uint256 amountOutMinimum, uint24 poolFee) external payable;
    function withdrawMargin(uint256 amount) external;

    function lockMargin(address user, uint256 amount) external;
    function releaseMargin(address user, uint256 amount) external;
    function borrowFromPool(bytes32 conditionId, uint256 amount) external;
    function repayToPool(bytes32 conditionId, uint256 amount) external;
    function fundPolymarketWallet(uint256 amount) external;
    function setPolymarketWallet(address _wallet) external;

    function creditBalance(address user, uint256 amount, uint64 sourceChain, bytes32 ccipMessageId) external;

    event CCIPDepositReceived(
        bytes32 indexed messageId,
        uint64 sourceChainSelector,
        address sender,
        uint256 amount
    );
}
