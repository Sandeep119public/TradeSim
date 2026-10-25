# TradeSim Roadmap

## Milestone 1: Replay + paper trading shell
- [x] Establish domain contracts for candles, deterministic replay, and a basic paper account.
- [x] Add replay/account unit tests.
- [ ] Mount the Lightweight Charts UI and wire it to replay state.
- [ ] Complete order submit/close flows and deterministic matching.
- [ ] Verify with `npm test` and `npm run build`.

## Milestone 2: Binance historical datasets
- [ ] Implement USDⓈ-M Futures kline download for public market data.
- [ ] Add bounded date ranges, pagination, retry/rate-limit handling, and data validation.
- [ ] Support CSV import/export for offline use.
- [ ] Keep replay datasets separate from live market data.

## Milestone 3: Futures realism
- [ ] Contract tick size, quantity step, minimum quantity/notional validation.
- [ ] Configurable fee assumptions.
- [ ] Stop-market, limit and attached SL/TP execution.
- [ ] Explicit candle-gap and OHLC ambiguity rules.
- [ ] Historical mark prices and funding events.
- [ ] Maintenance-margin tiers and liquidation simulation.

## Milestone 4: Research workflow
- [ ] Persist sessions locally.
- [ ] Event journal and reproducible replay seek.
- [ ] Trade log, equity curve, drawdown and performance summary.
- [ ] Trade-level replay and improved fill assumptions.

## Out of scope
- No real order placement.
- No Binance secrets in browser code.
- No claim that candle-touch fills reproduce actual order-book execution.
