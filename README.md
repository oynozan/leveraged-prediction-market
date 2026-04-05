## Pred Leverage

Pred Leverage is a leveraged prediction-market stack built around five main pieces:

1. `client/` is the Next.js frontend where users browse markets, trade, deposit, withdraw, and manage LP positions.
2. `server/` is the Express API that serves market data, authenticates users, talks to MongoDB, integrates with Polymarket, and submits on-chain actions.
3. `contracts/` contains the Solidity contracts for margin, LP liquidity, netting, fee distribution, recovery, and circuit breaking.
4. `cre/` contains Chainlink CRE workflows that automate syncing and recovery.
5. `scripts/` contains small Python operator utilities for Polymarket credentials and position inspection.

## How It Works

At a high level, the system works like this:

1. The frontend in `client/` calls the backend in `server/` using `NEXT_PUBLIC_API_URL`.
2. The backend serves public market data, verifies wallet-linked user requests with Privy identity tokens, and stores application state in MongoDB.
3. When blockchain features are enabled, the backend initializes `ethers` contract clients using deployed addresses and ABIs copied from `contracts/`.
4. Contract-aware services in `server/services/` manage vault deposits, trading, LP state, recovery, swaps, and netting.
5. CRE workflows in `cre/` run off-chain automation. They can call protected backend endpoints, read chain state, and submit CRE reports to on-chain receiver contracts.
6. Operational scripts in `scripts/` help with Polymarket API setup and manual inspection tasks.

## Folder Guide

- [`client/`](client/README.md): Next.js frontend, wallet/auth integration, trading and LP UI.
- [`server/`](server/README.md): Express API, MongoDB, Socket.IO, Privy auth, Polymarket, and contract integrations.
- [`contracts/`](contracts/README.md): Hardhat project for deploying and testing the Solidity contracts.
- [`cre/`](cre/README.md): Chainlink CRE workflows for market sync, recovery, circuit breaker, and rebalancing.
- [`scripts/`](scripts/README.md): Python utilities for Polymarket credentials and position lookup.

## Recommended Local Setup

For normal product development, you usually only need the frontend and backend:

1. Install dependencies in `client/` and `server/`.
2. Copy `client/.env.template` and `server/.env.template` into local env files and fill in the required values.
3. Start the backend from `server/`.
4. Start the frontend from `client/`.

The other folders are used when you need contract deployments, CRE automation, or Polymarket operator tooling.

## Notes

- `contracts/` and `server/` are linked by ABI files and deployed contract addresses.
- `cre/` depends on both backend routes and deployed contracts.
- `scripts/` is standalone and intended for manual/operator use.
