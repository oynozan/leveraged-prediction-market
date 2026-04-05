# Client

This folder contains the Next.js frontend for Pred Leverage. It is responsible for the user-facing experience: browsing markets, opening leveraged positions, depositing into the vault, withdrawing funds, and viewing LP data.

## What Lives Here

- `src/app/`: App Router pages such as the home market list, `trade/`, `deposit/`, `withdraw/`, and `lp/`.
- `src/components/`: Reusable UI for charts, market cards, tables, navbar, footer, and trading flows.
- `src/lib/api.ts`: HTTP client helpers for backend API calls.
- `src/components/providers/wallet.tsx`: Privy wallet and auth provider setup.
- `src/hooks/` and `src/contexts/`: Real-time and stateful frontend behavior.

## How It Connects To The Rest Of The Repo

- Talks to `../server/` over HTTP and Socket.IO using `NEXT_PUBLIC_API_URL`.
- Uses Privy for wallet-linked authentication and passes identity tokens to protected backend calls.
- Displays data that ultimately comes from the backend, Polymarket, MongoDB, and on-chain contracts.
- Uses `NEXT_PUBLIC_LPPOOL_ADDRESS` and `NEXT_PUBLIC_USDC_ADDRESS` for wallet-facing on-chain interactions.

## Environment

Start from `client/.env.template`.

Required values:

- `NEXT_PUBLIC_API_URL`: backend base URL, usually `http://localhost:5000`
- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_PRIVY_CLIENT_ID`
- `NEXT_PUBLIC_LPPOOL_ADDRESS`
- `NEXT_PUBLIC_USDC_ADDRESS`

## Commands

```bash
npm install
npm run dev
npm run build
npm run start
npm run lint
npm run format
```

The dev server runs on port `3000` by default.

## Typical Development Flow

1. Start `../server/` first.
2. Point `NEXT_PUBLIC_API_URL` at that backend.
3. Run `npm run dev`.
4. Open `http://localhost:3000`.

## Related Docs

- Root overview: [`../README.md`](../README.md)
- Backend/API: [`../server/README.md`](../server/README.md)
- Contracts: [`../contracts/README.md`](../contracts/README.md)
