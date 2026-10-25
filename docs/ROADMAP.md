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
- [x] Add attached stop-loss and take-profit levels to paper orders.
- [x] Resolve future-candle risk exits with gap-aware fills and conservative SL-first ambiguity handling.
- [x] Add tests for SL/TP levels, gap behavior, and same-candle ambiguity.
- [x] Load historical Binance funding rates and apply settlements through replay time.
- [x] Add funding cash-flow accounting and realized P&L integration.
- [x] Add fixed-rate maintenance-margin and simplified liquidation estimate/trigger with tests.
- [x] Preserve and reconstruct account/order/funding history deterministically on seek.
- [ ] Add cancel/replace behavior and more complete closed-trade reporting.

## Milestone 2: Binance historical datasets
- [x] Fetch a bounded window of public USDⓈ-M Futures klines.
- [x] Fetch historical funding-rate events for the loaded window.
- [ ] Add date-range pagination, retries and rate-limit handling.
- [x] Fetch historical mark-price candles so mark-to-market and liquidation checks use a better price source.
- [ ] Harden CSV schema detection and error reporting.
- [ ] Persist datasets locally for offline replay.
- [ ] Validate consistent interval and detect timestamp gaps.

## Milestone 3: Futures realism
- [ ] Load tick size, quantity step, minimum quantity/notional from exchange metadata.
- [ ] Add configurable maker/taker fee assumptions.
- [ ] Add standalone stop-market orders and editable risk levels on an open position.
- [ ] Replace the fixed maintenance-margin rate with symbol-specific notional brackets.
- [ ] Improve fills with trade-level replay; OHLC matching is only an approximation.
- [ ] Add partial fills and more realistic spread/market impact assumptions.

## Milestone 4: Research workflow
- [x] Event journal and reproducible replay seek with future-action truncation when branching.
- [ ] Trade log, equity curve, drawdown and performance summary.
- [ ] Save and restore replay sessions.

## Safety boundaries
- No real order placement.
- No Binance API secrets in browser code.
- No claim that candle-touch fills reproduce actual order-book execution.
