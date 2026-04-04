import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

function loadABI(name: string): ethers.InterfaceAbi {
    const abiPath = path.join(__dirname, "..", "abis", `${name}.json`);
    return JSON.parse(fs.readFileSync(abiPath, "utf-8"));
}

const lpPoolAbi = loadABI("LPPool");
const vaultAbi = loadABI("Vault");
const nettingEngineAbi = loadABI("NettingEngine");
const circuitBreakerAbi = loadABI("CircuitBreaker");
const feeDistributorAbi = loadABI("FeeDistributor");

let provider: ethers.JsonRpcProvider;
let operatorWallet: ethers.Wallet;
let lpPool: ethers.Contract;
let vault: ethers.Contract;
let nettingEngine: ethers.Contract;
let circuitBreaker: ethers.Contract;
let feeDistributor: ethers.Contract;

export function initContracts() {
    const rpcUrl = process.env.POLYGON_RPC_URL;
    if (!rpcUrl) throw new Error("POLYGON_RPC_URL is not set");

    provider = new ethers.JsonRpcProvider(rpcUrl);

    const pk = process.env.OPERATOR_PRIVATE_KEY;
    if (!pk) throw new Error("OPERATOR_PRIVATE_KEY is not set");
    operatorWallet = new ethers.Wallet(pk, provider);

    lpPool = new ethers.Contract(requireEnv("LPPOOL_ADDRESS"), lpPoolAbi, operatorWallet);
    vault = new ethers.Contract(requireEnv("VAULT_ADDRESS"), vaultAbi, operatorWallet);
    nettingEngine = new ethers.Contract(requireEnv("NETTING_ENGINE_ADDRESS"), nettingEngineAbi, operatorWallet);
    circuitBreaker = new ethers.Contract(requireEnv("CIRCUIT_BREAKER_ADDRESS"), circuitBreakerAbi, operatorWallet);
    feeDistributor = new ethers.Contract(requireEnv("FEE_DISTRIBUTOR_ADDRESS"), feeDistributorAbi, operatorWallet);

    console.log("[contracts] Initialized contract instances on", rpcUrl);
}

function requireEnv(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`${key} is not set`);
    return val;
}

export function getProvider() {
    return provider;
}

export function getOperatorWallet() {
    return operatorWallet;
}

export function getLPPoolContract() {
    return lpPool;
}

export function getVaultContract() {
    return vault;
}

export function getNettingEngineContract() {
    return nettingEngine;
}

export function getCircuitBreakerContract() {
    return circuitBreaker;
}

export function getFeeDistributorContract() {
    return feeDistributor;
}
