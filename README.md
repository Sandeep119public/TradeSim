# TradeSim

TradeSim is a local-first simulator for replaying historical Binance USDⓈ-M futures candles and practicing with paper-only trades.

## Current prototype

- TypeScript + Vite web terminal and Lightweight Charts candlestick chart
- Candle replay with play/pause, speed, single-step and seeking
- Public Binance Futures kline fetch for a bounded recent window (up to 1,000 candles)
- Fetches public historical funding-rate events for the loaded window when available
- CSV candle import
- Paper Long/Short orders with leverage and a margin preview
- Market orders fill at the next eligible candle open
- Limit orders can fill only on future candles using an explicit OHLC touch/gap model
- Attached stop-loss and take-profit exits, with stop-first handling if both levels are touched in one candle
- Funding payments credited/debited at historical settlement timestamps while a position is open
- Simplified maintenance-margin and liquidation estimate for a one-position cross-equity account
- Paper wallet, fees, funding, realized/unrealized P&L, position display, and order activity

## Run locally

Requires Node.js 20.19+.

```sh
npm install
npm run dev
npm test
npm run build
```

## Known limitations

- This is an early prototype. Check [GitHub Actions](https://github.com/Sandeep119public/TradeSim/actions) for current build/test status.
- Seeking resets account and order history instead of reconstructing historical trading events.
- The Binance market-data download has no arbitrary date-range pagination or retry/resume yet.
- The liquidation model uses a configurable fixed 0.5% maintenance-margin rate and trade-candle OHLC as a proxy. It is not Binance's mark-price/bracket-accurate liquidation model.
- Funding uses the historical funding-rate endpoint. When a historical mark price is absent from the funding response, the event candle close is used as an approximation.
- The simulator supports one open position at a time and does not yet model partial fills, queue position, tick/step size constraints, standalone stop-market entry orders, or editable SL/TP after entry.
- Historical OHLC data cannot reconstruct actual intrabar trade order or order-book fills.

## Safety

All orders are paper-only. There is no live order-placement integration. Do not put Binance API secrets in browser code or this repository.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the staged plan.
