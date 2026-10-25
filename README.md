# TradeSim

TradeSim is a local-first simulator for replaying historical Binance USDⓈ-M futures candles and practicing with paper-only trades.

## Current prototype

- TypeScript + Vite web terminal and Lightweight Charts candlestick chart
- Candle replay with play/pause, speed, single-step and seeking
- Public Binance Futures kline fetch for a bounded recent window (up to 1,000 candles)
- Fetches public historical funding-rate events and mark-price candles for the loaded window when available
- CSV candle import
- Paper Long/Short orders with leverage and a margin preview
- Market orders fill at the next eligible candle open
- Limit orders can fill only on future candles using an explicit OHLC touch/gap model
- Attached stop-loss and take-profit exits, with stop-first handling if both levels are touched in one candle
- Attached SL/TP triggers use trade-price candle OHLC; liquidation uses mark-price OHLC when aligned data exists, otherwise trade-price OHLC
- If liquidation and another exit are touched in one candle, liquidation wins because OHLC cannot establish their intrabar order; SL still wins when both SL and TP are touched
- The entire fill candle is checked for risk exits after the fill. For intrabar limit fills, this conservatively applies the candle's full OHLC range because the price path is unknown.
- Funding payments credited/debited at historical settlement timestamps while a position is open
- Uses historical mark-price candles for mark-to-market and liquidation OHLC checks when available
- Simplified maintenance-margin and liquidation estimate for a one-position cross-equity account
- Deterministic seek reconstructs fills, fees, funding, exits, cancels, manual closes and reset events
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
- Seeking rebuilds account/order/funding state from the ordered action journal. Placing an action after seeking branches the session and drops actions from later replay indices.
- The Binance market-data download has no arbitrary date-range pagination or retry/resume yet; it is still bounded to 1,000 candles.
- The liquidation model uses historical mark-price OHLC when aligned mark candles are available, but still uses a simplified fixed 0.5% maintenance-margin rate. It is not Binance's exact mark-price/bracket-accurate liquidation model.
- Funding uses the historical funding-rate endpoint and prefers its event mark price. If absent, an exact-time or still-available mark-candle open, then the latest completed prior mark close is used. If neither exists, the settlement is skipped and recorded; no trade-candle close fallback is used.
- The simulator supports one open position at a time and does not yet model partial fills, queue position, tick/step size constraints, standalone stop-market entry orders, or editable SL/TP after entry.
- Historical OHLC data cannot reconstruct actual intrabar trade order or order-book fills.

## Safety

All orders are paper-only. There is no live order-placement integration. Do not put Binance API secrets in browser code or this repository.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the staged plan.
