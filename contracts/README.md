# Contracts

This folder contains the Solidity and Hardhat code for the on-chain part of Pred Leverage.

## What Lives Here

- `contracts/`: Solidity contracts such as `Vault`, `LPPool`, `NettingEngine`, `CircuitBreaker`, `FeeDistributor`, and `RecoveryReceiver`.
- `scripts/`: deployment and operational scripts for deployment, role assignment, recovery receiver deployment, ABI copying, and wallet maintenance.
- `test/`: Hardhat tests.
- `deployments/`: saved deployment outputs by network.
- `hardhat.config.ts`: network and compiler configuration.

## Main Responsibilities

- Deploy the core contracts used by the backend and automation workflows.
- Define protocol roles such as operator, rebalancer, circuit breaker, bridge monitor, and vault-linked permissions.
- Produce ABI artifacts that can be copied into `../server/abis/`.

## Environment

Start from `contracts/.env.example`.

Common variables:

- `DEPLOYER_PRIVATE_KEY`
- `POLYGON_RPC_URL`
- `AMOY_RPC_URL`
- `SEPOLIA_RPC_URL`
- `USDC_ADDRESS`
- `SWAP_ROUTER_ADDRESS`
- `WETH_ADDRESS`
- `OPERATOR_ADDRESS`
- `REBALANCER_ADDRESS`
- `CB_WORKFLOW_ADDRESS`
- `BRIDGE_MONITOR_ADDRESS`
- `POLYMARKET_WALLET_ADDRESS` or `POLYMARKET_WALLET_PK`
- `FORWARDER_ADDRESS` for recovery receiver deployment

## Commands

```bash
npm install
npm run compile
npm run test
npm run test:local
npm run deploy:amoy
npm run deploy:polygon
npm run deploy:sepolia
npm run grant-roles:amoy
npm run grant-roles:polygon
npm run grant-roles:sepolia
npm run deploy-recovery-receiver:polygon
npm run copy-abis
```

## Workflow

1. Configure env values for the target network.
2. Deploy contracts with one of the `deploy:*` scripts.
3. Grant the required roles.
4. Run `npm run copy-abis` so `../server/` can load the latest ABI files.
5. Update `../server/` and `../cre/` configs with the deployed addresses.

## Related Docs

- Root overview: [`../README.md`](../README.md)
- Backend integration: [`../server/README.md`](../server/README.md)
- CRE automation: [`../cre/README.md`](../cre/README.md)
