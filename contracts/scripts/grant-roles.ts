import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeployedAddresses {
    CircuitBreaker: string;
    NettingEngine: string;
    LPPool: string;
    Vault: string;
    FeeDistributor: string;
}

function loadAddresses(networkName: string): DeployedAddresses {
    const deployFile = path.join(__dirname, "..", "deployments", `${networkName}.json`);

    if (fs.existsSync(deployFile)) {
        const data = JSON.parse(fs.readFileSync(deployFile, "utf-8"));
        console.log(`Loaded addresses from ${deployFile}`);
        return data.contracts;
    }

    const required = [
        "CIRCUIT_BREAKER_ADDRESS",
        "NETTING_ENGINE_ADDRESS",
        "LPPOOL_ADDRESS",
        "VAULT_ADDRESS",
        "FEE_DISTRIBUTOR_ADDRESS",
    ] as const;

    for (const key of required) {
        if (!process.env[key]) {
            throw new Error(
                `No deployment file found at ${deployFile} and env var ${key} is not set.\n` +
                    `Either create the deployment file or set all contract address env vars.`,
            );
        }
    }

    console.log("Loaded addresses from environment variables");
    return {
        CircuitBreaker: process.env.CIRCUIT_BREAKER_ADDRESS!,
        NettingEngine: process.env.NETTING_ENGINE_ADDRESS!,
        LPPool: process.env.LPPOOL_ADDRESS!,
        Vault: process.env.VAULT_ADDRESS!,
        FeeDistributor: process.env.FEE_DISTRIBUTOR_ADDRESS!,
    };
}

async function main() {
    const [signer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);
    const networkName = network.name === "unknown" ? `chain-${chainId}` : network.name;

    console.log(`Granting roles with account: ${signer.address}`);
    console.log(`Network: ${networkName} (chainId: ${chainId})`);

    const addrs = loadAddresses(networkName);
    console.log("Contract addresses:", addrs);

    const OPERATOR_ADDRESS = process.env.OPERATOR_ADDRESS || signer.address;
    const REBALANCER_ADDRESS = process.env.REBALANCER_ADDRESS || signer.address;
    const CB_WORKFLOW_ADDRESS = process.env.CB_WORKFLOW_ADDRESS || signer.address;
    const BRIDGE_MONITOR_ADDRESS = process.env.BRIDGE_MONITOR_ADDRESS || signer.address;

    console.log(`Operator: ${OPERATOR_ADDRESS}`);
    console.log(`Rebalancer: ${REBALANCER_ADDRESS}`);
    console.log(`CB Workflow: ${CB_WORKFLOW_ADDRESS}`);
    console.log(`Bridge Monitor: ${BRIDGE_MONITOR_ADDRESS}`);

    const pool = await ethers.getContractAt("LPPool", addrs.LPPool);
    const vault = await ethers.getContractAt("Vault", addrs.Vault);
    const engine = await ethers.getContractAt("NettingEngine", addrs.NettingEngine);
    const cb = await ethers.getContractAt("CircuitBreaker", addrs.CircuitBreaker);
    const feeDist = await ethers.getContractAt("FeeDistributor", addrs.FeeDistributor);

    const BORROWER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BORROWER_ROLE"));
    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    const REBALANCER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REBALANCER_ROLE"));
    const CB_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CIRCUIT_BREAKER_ROLE"));
    const BRIDGE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ROLE"));
    const VAULT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VAULT_ROLE"));

    const grants: { label: string; fn: () => Promise<any> }[] = [
        {
            label: "BORROWER_ROLE on LPPool -> Vault",
            fn: () => pool.grantRole(BORROWER_ROLE, addrs.Vault),
        },
        {
            label: "OPERATOR_ROLE on Vault -> operator",
            fn: () => vault.grantRole(OPERATOR_ROLE, OPERATOR_ADDRESS),
        },
        {
            label: "OPERATOR_ROLE on NettingEngine -> operator",
            fn: () => engine.grantRole(OPERATOR_ROLE, OPERATOR_ADDRESS),
        },
        {
            label: "REBALANCER_ROLE on NettingEngine -> rebalancer",
            fn: () => engine.grantRole(REBALANCER_ROLE, REBALANCER_ADDRESS),
        },
        {
            label: "CIRCUIT_BREAKER_ROLE on CircuitBreaker -> CB workflow",
            fn: () => cb.grantRole(CB_ROLE, CB_WORKFLOW_ADDRESS),
        },
        {
            label: "BRIDGE_ROLE on Vault -> bridge monitor",
            fn: () => vault.grantRole(BRIDGE_ROLE, BRIDGE_MONITOR_ADDRESS),
        },
        {
            label: "VAULT_ROLE on FeeDistributor -> Vault",
            fn: () => feeDist.grantRole(VAULT_ROLE, addrs.Vault),
        },
    ];

    for (const { label, fn } of grants) {
        console.log(`  Granting ${label}...`);
        const tx = await fn();
        await tx.wait();
        console.log(`  Done (tx: ${tx.hash})`);
    }

    console.log("\nAll roles granted successfully.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
