# Scripts

This folder contains small Python utilities for Polymarket-related operator tasks.

## Files

- `create-polymarket-api-credentials.py`: derives or creates API credentials for Polymarket CLOB using a private key.
- `polymarket_positions.py`: looks up YES/NO positions for a wallet by market slug, event slug, or condition ID.
- `.env.template`: minimal local env template for the credentials helper.

## What These Scripts Are For

These scripts are not part of the main application runtime. They are standalone helper tools for setup, debugging, and operator workflows around Polymarket.

## Environment

Start from `scripts/.env.template`.

Common values:

- `PRIVATE_KEY` for `create-polymarket-api-credentials.py`
- optional `PROXY_URL` if requests should go through a proxy

## Usage

Install the Python dependencies you need in your environment, then run the scripts directly.

Examples:

```bash
python create-polymarket-api-credentials.py
python polymarket_positions.py 0xYourWalletAddress market-slug
python polymarket_positions.py 0xYourWalletAddress 0xConditionId
```

`polymarket_positions.py` requires `requests`.

`create-polymarket-api-credentials.py` uses `python-dotenv` and `py-clob-client`.

## How It Connects To The Rest Of The Repo

- Shares the same Polymarket domain concepts used by `../server/` and `../cre/`.
- Does not run automatically as part of the frontend or backend.
- Useful for local operator setup and manual inspection.

## Related Docs

- Root overview: [`../README.md`](../README.md)
- Backend integration: [`../server/README.md`](../server/README.md)
- CRE workflows: [`../cre/README.md`](../cre/README.md)
