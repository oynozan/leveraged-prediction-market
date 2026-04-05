# Server

This folder contains the Express backend for Pred Leverage. It serves public market data, verifies authenticated user actions, stores application state in MongoDB, integrates with Polymarket, exposes live updates over Socket.IO, and can submit on-chain transactions when contract configuration is present.

## What Lives Here

- `server.ts`: application bootstrap, MongoDB connection, middleware, routes, sockets, and optional contract initialization.
- `routes/public/`: public API endpoints for markets, trade, positions, deposit, LP data, health, and ping.
- `routes/protected/`: server-to-server endpoints used by automation and privileged workflows.
- `services/`: business logic for trading, vault operations, LP state, swaps, recovery, netting, bridge helpers, and Polymarket access.
- `lib/contracts.ts`: loads ABIs from `abis/` and creates `ethers` clients for deployed contracts.
- `socket/`: Socket.IO server and listeners.

## How It Connects To The Rest Of The Repo

- Serves the frontend in `../client/`.
- Uses ABIs and deployed addresses from `../contracts/`.
- Exposes protected routes used by workflows in `../cre/`.
- Shares Polymarket-related operational concerns with `../scripts/`.

## Environment

Start from `server/.env.template`.

Common variables:

- `CLIENT`: allowed frontend origin
- `SERVER_PORT`
- `MONGO_URI`
- `JWT_SECRET`: used for user auth cookies
- `JWT_ISSUER` and `PUBLIC_KEY_PATH`: used for server-to-server auth verification
- `PRIVY_APP_ID` and `PRIVY_APP_SECRET`
- `POLYGON_RPC_URL` and `OPERATOR_PRIVATE_KEY`
- `LPPOOL_ADDRESS`, `VAULT_ADDRESS`, `NETTING_ENGINE_ADDRESS`, `CIRCUIT_BREAKER_ADDRESS`, `FEE_DISTRIBUTOR_ADDRESS`
- `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_PASSPHRASE`, `POLY_WALLET_PK`
- `CLOB_API_URL` and optional `PROXY_URL`

If `POLYGON_RPC_URL` or `OPERATOR_PRIVATE_KEY` is missing, the server still starts, but contract-backed features are skipped.

## Commands

```bash
npm install
npm run dev
npm run build
npm run start
npm run test
npm run lint
npm run lint:fix
npm run format
```

## Auth Notes

There are two auth paths:

1. User authentication for wallet-linked frontend requests.
2. Server-to-server authentication for protected routes used by workflows or backend-only clients.

For server-to-server auth, generate an ES256 keypair and point `PUBLIC_KEY_PATH` at the public key file. For user auth, generate a random `JWT_SECRET`.

## Typical Development Flow

1. Copy `server/.env.template` into a local env file.
2. Make sure MongoDB is reachable.
3. If you need contract-backed features, deploy contracts in `../contracts/`, copy ABIs, and set the contract addresses here.
4. Run `npm run dev`.

## Related Docs

- Root overview: [`../README.md`](../README.md)
- Frontend: [`../client/README.md`](../client/README.md)
- Contracts: [`../contracts/README.md`](../contracts/README.md)
- CRE workflows: [`../cre/README.md`](../cre/README.md)
