import { ethers, network } from "hardhat";

// Polygon mainnet addresses
export const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
export const WETH_ADDRESS = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
export const WMATIC_ADDRESS = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
export const SWAP_ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

const IERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address, uint256) returns (bool)",
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)",
    "function decimals() view returns (uint8)",
];

export const USDC = (n: number) => ethers.parseUnits(n.toString(), 6);

export async function getUSDC() {
    return new ethers.Contract(USDC_ADDRESS, IERC20_ABI, ethers.provider);
}

export async function getWETH() {
    return new ethers.Contract(WETH_ADDRESS, IERC20_ABI, ethers.provider);
}

/**
 * Compute the storage slot for a mapping(address => uint256) value.
 * slot = keccak256(abi.encode(key, mappingSlot))
 */
function getBalanceSlot(address: string, mappingSlot: number): string {
    return ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256"],
            [address, mappingSlot],
        ),
    );
}

/**
 * Set an ERC-20 balance directly via storage manipulation.
 * This avoids depending on whale balances and works for any fork state.
 */
async function setTokenBalance(
    tokenAddress: string,
    recipient: string,
    amount: bigint,
    balanceSlotIndex: number,
) {
    const slot = getBalanceSlot(recipient, balanceSlotIndex);
    const value = ethers.toBeHex(amount, 32);

    await network.provider.send("hardhat_setStorageAt", [tokenAddress, slot, value]);
}

/**
 * Fund an address with USDC on forked Polygon.
 * USDC (Circle FiatTokenV2_2) stores balances at slot 9.
 */
export async function fundWithUSDC(recipient: string, amount: bigint): Promise<void> {
    await setTokenBalance(USDC_ADDRESS, recipient, amount, 9);

    // Also give native MATIC for gas
    await network.provider.send("hardhat_setBalance", [
        recipient,
        "0x56BC75E2D63100000", // 100 MATIC
    ]);
}

/**
 * Fund an address with WETH on forked Polygon.
 * WETH (bridged) stores balances at slot 0.
 */
export async function fundWithWETH(recipient: string, amount: bigint): Promise<void> {
    await setTokenBalance(WETH_ADDRESS, recipient, amount, 0);
}
