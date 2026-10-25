# TradeSim Roadmap

## Milestone 1: Replay + paper trading shell
- [x] Establish fresh Vite + TypeScript application.
- [x] Add validated candle schema and deterministic replay engine.
- [x] Fix play/pause so continuous playback advances through bars.
- [x] Add leverage-aware starter paper account, wallet, margin, fees and P&L.
- [x] Add chart terminal, replay controls, bounded public Binance kline fetch and CSV import.
- [x] Queue market orders for the next eligible bar open.
- [x] Match limit orders only on future bars using explicit OHLC touch/gap assumptions.
- [x] Add matching unit tests and a GitHub Actions test/build workflow.
- [ ] Preserve and reconstruct account/order history deterministically on seek.
- [ ] Add cancel/replace behavior and more complete closed-trade reporting.

## Milestone 2: Binance historical datasets
- [x] Fetch a bounded window of public USDⓈ-M Futures klines.
- [ ] Add date-range pagination, retries and rate-limit handling.
- [ ] Harden CSV schema detection and error reporting.
- [ ] Persist datasets locally for offline replay.
- [ ] Validate consistent interval and detect timestamp gaps.

## Milestone 3: Futures realism
- [ ] Load tick size, quantity step, minimum quantity/notional from exchange metadata.
- [ ] Add configurable maker/taker fee assumptions.
- [ ] Add stop-market and attached SL/TP execution.
- [ ] Integrate historical mark prices and funding events.
- [ ] Add maintenance-margin tiers and liquidation simulation.
- [ ] Improve fills with trade-level replay; OHLC matching is only an approximation.

## Milestone 4: Research workflow
- [ ] Event journal and reproducible replay seek.
- [ ] Trade log, equity curve, drawdown and performance summary.
- [ ] Save and restore replay sessions.

## Safety boundaries
- No real order placement.
- No Binance API secrets in browser code.
- No claim that candle-touch fills reproduce actual order-book execution.
