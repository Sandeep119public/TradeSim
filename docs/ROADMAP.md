# TradeSim Roadmap

## Milestone 1: Replay + paper trading shell
- [x] Establish a fresh Vite + TypeScript repository.
- [x] Add candle schema and deterministic replay engine.
- [x] Add starter paper account with leverage-based initial margin and fee accounting.
- [x] Add first unit tests.
- [x] Add chart terminal, replay controls, public Binance kline fetch and CSV import.
- [ ] Run clean install, tests and production build in local/CI environment.
- [ ] Implement pending limit orders on future bars and explicit fill rules.
- [ ] Reconstruct account state deterministically after seek.

## Milestone 2: Binance historical datasets
- [x] Fetch a bounded window of public USDⓈ-M Futures klines.
- [ ] Add date-range pagination, retry/rate-limit handling and larger local datasets.
- [ ] Harden CSV schema detection and malformed-data reporting.
- [ ] Persist replay datasets locally.
- [ ] Keep historical replay data separate from live market data.

## Milestone 3: Futures realism
- [ ] Contract tick size, quantity step, minimum quantity/notional validation from exchange metadata.
- [ ] Configurable fee assumptions.
- [ ] Stop-market and attached SL/TP execution.
- [ ] Explicit candle-gap and OHLC ambiguity rules.
- [ ] Historical mark prices and funding events.
- [ ] Maintenance-margin tiers and liquidation simulation.

## Milestone 4: Research workflow
- [ ] Event journal and reproducible replay seek.
- [ ] Trade log, equity curve, drawdown and performance summary.
- [ ] Trade-level replay and documented fill assumptions.

## Out of scope
- No real order placement.
- No Binance secrets in browser code.
- No claim that candle-touch fills reproduce actual order-book execution.
