# Solana Compare

A live, client-side dashboard for comparing two Solana tokens.

## Data sources

- **Jupiter Tokens API** — token metadata, holder count and holder changes, price,
  market cap, liquidity, trading activity, and organic score.
- **DEX Screener API** — independent pool discovery and validation, trusted-pair
  liquidity, pool count, and fallback market data.
- **GeckoTerminal Public API** — hourly OHLCV data for the 24-hour relative-price chart.

All three are called directly from the browser. No wallet, private key, or backend is
required. Jupiter's keyless endpoint is currently rate limited and may move to a free
developer key in the future.

## Run locally

```powershell
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Production build

```powershell
npm run build
```

The static site is written to `dist/` and can be deployed to any static host.
