import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const POLYGON_RPC = process.env.POLYGON_RPC_URL || "https://polygon.drpc.org";
const AMOY_RPC = process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.34",
        settings: {
            optimizer: { enabled: true, runs: 200 },
            evmVersion: "cancun",
            viaIR: true,
        },
    },
    networks: {
        hardhat: {
            forking: {
                url: POLYGON_RPC,
                enabled: !!process.env.FORK_POLYGON,
            },
        },
        polygon: {
            url: POLYGON_RPC,
            accounts: [DEPLOYER_KEY],
            chainId: 137,
        },
        amoy: {
            url: AMOY_RPC,
            accounts: [DEPLOYER_KEY],
            chainId: 80002,
        },
        sepolia: {
            url: SEPOLIA_RPC,
            accounts: [DEPLOYER_KEY],
            chainId: 11155111,
        },
    },
    typechain: {
        outDir: "typechain-types",
        target: "ethers-v6",
    },
};

export default config;
