const fs = require("fs");
const path = require("path");

const CONTRACTS = [
    "LPPool",
    "Vault",
    "NettingEngine",
    "CircuitBreaker",
    "FeeDistributor",
];

const artifactsRoot = path.join(__dirname, "..", "artifacts", "contracts");
const outDir = path.join(__dirname, "..", "..", "server", "abis");

if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

for (const name of CONTRACTS) {
    const artifactPath = path.join(artifactsRoot, `${name}.sol`, `${name}.json`);

    if (!fs.existsSync(artifactPath)) {
        console.warn(`Artifact not found: ${artifactPath} — skipping`);
        continue;
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const abi = artifact.abi;

    const outFile = path.join(outDir, `${name}.json`);
    fs.writeFileSync(outFile, JSON.stringify(abi, null, 2));
    console.log(`Copied ABI: ${name} → ${outFile}`);
}

console.log("Done.");
