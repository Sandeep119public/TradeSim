# TradeSim

TradeSim is a local-first simulator for replaying historical Binance USDⓈ-M futures candles and practicing with paper-only trades.

## Current prototype

- TypeScript + Vite web terminal and Lightweight Charts candlestick chart
- Candle replay with play/pause, speed, single-step and seeking
- Public Binance Futures candle loading for the latest 1,000 closed candles or a selected date/time range, paginated across responses with transient/rate-limit retries
- Explicit safety ceiling of 100,000 candles per load to protect browser memory and seek performance
- Timestamp spacing diagnostics for Binance candles; missing bars are reported, never fabricated
- Chromium end-to-end tests exercise historical-range pagination, in-flight control locking, optional-endpoint failures, and gap warnings using mocked Binance responses
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
npx playwright install chromium  # one-time browser install for local E2E runs
npm run test:e2e                  # deterministic tests with mocked Binance responses
npm run test:e2e:live             # optional live Binance smoke test; requires network access
```

## Live data smoke test

The live smoke test loads the latest 1,000 fully closed candles in Chromium, requires all 1,000 aligned mark candles and a non-empty funding history, rejects exchange warnings or candle gaps, checks the returned dataset matches the selected symbol/timeframe, confirms the last candle is closed, and steps the replay once. It only uses public Binance Futures market-data endpoints and never places an order.

To run it in GitHub Actions, open the **CI** workflow, choose **Run workflow**, select the `feature/historical-data-range` branch, choose the market (`BTCUSDT`, `SOLUSDT`, or `ETHUSDT`) and timeframe (`1m`, `5m`, `15m`, or `1h`), then dispatch it. The live-network step runs only for manual dispatches; normal pull-request CI stays deterministic and uses mocked exchange responses. Rate limits, exchange availability, or network-region restrictions can affect the live smoke test.

## Known limitations

- This is an early prototype. Check [GitHub Actions](https://github.com/Sandeep119public/TradeSim/actions) for current build/test status.
- Seeking rebuilds account/order/funding state from the ordered action journal. Placing an action after seeking branches the session and drops actions from later replay indices.
- The Binance loader paginates selected date ranges with bounded retries for network, rate-limit, and transient server errors. Each load is capped at 100,000 candles; resumable downloads and persistent caching are not yet implemented.
- The liquidation model uses historical mark-price OHLC when aligned mark candles are available, but still uses a simplified fixed 0.5% maintenance-margin rate. It is not Binance's exact mark-price/bracket-accurate liquidation model.
- Funding uses the historical funding-rate endpoint and prefers its event mark price. If absent, an exact-time or still-available mark-candle open, then the latest completed prior mark close is used. If neither exists, the settlement is skipped and recorded; no trade-candle close fallback is used.
- The simulator supports one open position at a time and does not yet model partial fills, queue position, tick/step size constraints, standalone stop-market entry orders, or editable SL/TP after entry.
- Historical OHLC data cannot reconstruct actual intrabar trade order or order-book fills.

## Safety

All orders are paper-only. There is no live order-placement integration. Do not put Binance API secrets in browser code or this repository.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the staged plan.
