# CRE

This folder contains the Chainlink CRE workflows used to automate off-chain operations for Pred Leverage.

## What Lives Here

- `market-sync-workflow/`: cron-driven workflow that syncs Polymarket market data into the backend.
- `recovery-workflow/`: recovery flow that reads backend and chain state, then reports recovery actions on-chain.
- `contracts/abi/`: TypeScript ABI definitions used by the workflows.
- `project.yaml`: CRE target settings and RPC definitions.
- `secrets.yaml`: shared CRE secret names referenced by workflow configs.

## How It Connects To The Rest Of The Repo

- Calls protected endpoints in `../server/`.
- Uses deployed contract addresses from the on-chain system in `../contracts/`.

## Workflow Layout

Each workflow directory typically contains:

- `main.ts`: workflow implementation
- `workflow.yaml`: workflow metadata and config mapping
- `config.staging.json` and `config.production.json`: environment-specific runtime config
- `package.json`: workflow-local dependencies and `typecheck` script

## Commands

There is no single workspace command that installs or runs every workflow. Each workflow is its own package.

Typical pattern:

```bash
cd market-sync-workflow
npm install
npm run typecheck
```

Simulation and deployment are done with the CRE CLI from the repo context, for example:

```bash
cre workflow simulate cre/market-sync-workflow --target=staging-settings
```

Use the same pattern for the other workflow folders.

## Shared Configuration

- `project.yaml` defines target RPCs such as `staging-settings` and `production-settings`.
- `secrets.yaml` names shared secrets such as backend auth tokens and Polymarket credentials.
- Workflow config JSON files hold backend URLs, contract addresses, thresholds, and network-specific settings.

## When You Need This Folder

Use `cre/` when you need automated backend synchronization or protocol operations such as:

- syncing market metadata
- recovering stale balances or borrows

## Related Docs

- Root overview: [`../README.md`](../README.md)
- Backend integration: [`../server/README.md`](../server/README.md)
- On-chain contracts: [`../contracts/README.md`](../contracts/README.md)
