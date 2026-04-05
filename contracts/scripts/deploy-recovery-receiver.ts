import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

function loadVaultAddress(networkName: string): string {
    if (process.env.VAULT_ADDRESS) {
        console.log("Loaded Vault address from VAULT_ADDRESS env var");
        return process.env.VAULT_ADDRESS;
    }

    const deployFile = path.join(__dirname, "..", "deployments", `${networkName}.json`);
    if (fs.existsSync(deployFile)) {
        const data = JSON.parse(fs.readFileSync(deployFile, "utf-8"));
        const vault = data.contracts?.Vault;
        if (!vault) throw new Error(`No Vault address found in ${deployFile}`);
        console.log(`Loaded Vault address from ${deployFile}`);
        return vault;
    }

    throw new Error(
        `No Vault address available. Set VAULT_ADDRESS env var or ensure deployments/${networkName}.json exists.`,
    );
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);
    const networkName = network.name === "unknown" ? `chain-${chainId}` : network.name;

    console.log(`Deploying RecoveryReceiver with account: ${deployer.address}`);
    console.log(`Network: ${networkName} (chainId: ${chainId})`);

    const vaultAddress = loadVaultAddress(networkName);

    const forwarderAddress = process.env.FORWARDER_ADDRESS;
    if (!forwarderAddress) {
        throw new Error("FORWARDER_ADDRESS env var is required (KeystoneForwarder address)");
    }

    console.log(`Vault:     ${vaultAddress}`);
    console.log(`Forwarder: ${forwarderAddress}`);

    const RecoveryReceiver = await ethers.getContractFactory("RecoveryReceiver");
    const receiver = await RecoveryReceiver.deploy(vaultAddress, forwarderAddress);
    await receiver.waitForDeployment();
    const receiverAddress = await receiver.getAddress();
    console.log(`RecoveryReceiver deployed at: ${receiverAddress}`);

    // Grant OPERATOR_ROLE on Vault so the receiver can call releaseMargin / repayToPool
    const vault = await ethers.getContractAt("Vault", vaultAddress);
    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    console.log("Granting OPERATOR_ROLE on Vault -> RecoveryReceiver...");
    const tx = await vault.grantRole(OPERATOR_ROLE, receiverAddress);
    await tx.wait();
    console.log(`  Done (tx: ${tx.hash})`);

    // Persist the address into the existing deployment file
    const deployDir = path.join(__dirname, "..", "deployments");
    if (!fs.existsSync(deployDir)) {
        fs.mkdirSync(deployDir, { recursive: true });
    }
    const deployFile = path.join(deployDir, `${networkName}.json`);

    let deployments: Record<string, any> = {};
    if (fs.existsSync(deployFile)) {
        deployments = JSON.parse(fs.readFileSync(deployFile, "utf-8"));
    }

    deployments.contracts = {
        ...deployments.contracts,
        RecoveryReceiver: receiverAddress,
    };
    deployments.recoveryReceiver = {
        deployer: deployer.address,
        forwarder: forwarderAddress,
        vault: vaultAddress,
        deployedAt: new Date().toISOString(),
    };

    fs.writeFileSync(deployFile, JSON.stringify(deployments, null, 2));
    console.log(`RecoveryReceiver address saved to ${deployFile}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
