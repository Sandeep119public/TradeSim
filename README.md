# TradeSim

TradeSim is a local-first simulator for replaying historical Binance USDⓈ-M futures candles and practicing with paper-only trades.

## Current prototype

- TypeScript + Vite web terminal and Lightweight Charts candlestick chart
- Candle replay with play/pause, speed, single-step and seeking
- Public Binance Futures kline fetch for a bounded recent window
- CSV candle import
- Paper Long/Short orders with leverage and a margin preview
- Market orders fill at the next eligible candle open
- Limit orders can fill only on future candles using a clearly approximate OHLC touch model
- Paper wallet, fees, unrealized/realized P&L, position display, and order activity

## Run locally

Requires Node.js 20.19+.

```sh
npm install
npm run dev
npm test
npm run build
```

## Known limitations

- This is an early prototype; use the CI run as the source of truth for current build/test status.
- Seeking resets account and order history instead of reconstructing historical trading events.
- The public Binance fetch is limited to 1,000 candles; date-range pagination and retries are not implemented.
- The simulator supports one open position at a time and does not yet model partial fills, queue position, tick/step sizes, mark-price liquidation, stop-loss/take-profit execution, or funding.
- Historical OHLC data cannot reconstruct actual intrabar trade order or order-book fills.

## Safety

All orders are paper-only. There is no live order-placement integration. Do not put Binance API secrets in browser code or this repository.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the staged plan.
