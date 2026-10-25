import type { Candle } from "./market";
import { resolveLiquidationExit } from "./liquidation";
import { matchMarkCandle, historicalMarkAt, type MarkPriceCandle } from "./mark-price";
import { resolveFillPrice } from "./matching";
import { PaperAccount, type AccountSnapshot, type PaperAccountOptions, type Side } from "./paper-account";
import { ReplayEngine, type ReplaySnapshot } from "./replay";
import { resolveRiskExit } from "./risk-exits";
import { ReplayActionJournal } from "./session-journal";

export interface HistoricalFunding {
  fundingTime: number;
  fundingRate: number;
  markPrice: number | null;
}

export interface OrderIntent {
  symbol: string;
  side: Side;
  type: "market" | "limit";
  quantity: number;
  leverage: number;
  limitPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
}

export type OrderStatus = "PENDING" | "FILLED" | "REJECTED" | "CANCELLED";

export interface PaperOrder extends OrderIntent {
  id: number;
  createdIndex: number;
  status: OrderStatus;
  filledPrice: number | null;
  message?: string;
}

export interface SessionActivity {
  timestamp: number | null;
  message: string;
  tone: "" | "positive" | "negative";
}

type SessionAction =
  | { kind: "submit"; index: number; order: OrderIntent }
  | { kind: "close"; index: number }
  | { kind: "cancel-pending"; index: number }
  | { kind: "reset"; index: number };

export interface ReplaySessionOptions {
  candleIntervalMs: number;
  account?: PaperAccountOptions;
}

/**
 * Deterministic paper-account runner shared by live replay and seek reconstruction.
 * If liquidation and another risk exit are both touched in one OHLC candle,
 * liquidation wins because the candle cannot establish their intrabar order.
 * A fill candle is evaluated after the fill using its full OHLC range. For a
 * limit fill, this conservatively includes any range that may have occurred
 * before the fill; OHLC data cannot prove the intrabar sequence.
 */
export class ReplaySession {
  private readonly replay = new ReplayEngine();
  private readonly candles: readonly Candle[];
  private readonly fundingEvents: readonly HistoricalFunding[];
  private readonly markCandles: readonly MarkPriceCandle[];
  private readonly marksByTime: ReadonlyMap<number, MarkPriceCandle>;
  private readonly candleIntervalMs: number;
  private readonly accountOptions: PaperAccountOptions;
  private readonly journal = new ReplayActionJournal<SessionAction>();
  private account: PaperAccount;
  private orders: PaperOrder[] = [];
  private activities: SessionActivity[] = [];
  private nextOrderId = 1;
  private fundingCursor = 0;
  private positionOpenedIndex = -1;

  constructor(
    candles: readonly Candle[],
    fundingEvents: readonly HistoricalFunding[] = [],
    markCandles: readonly MarkPriceCandle[] = [],
    { candleIntervalMs, account = {} }: ReplaySessionOptions,
  ) {
    if (!Number.isFinite(candleIntervalMs) || candleIntervalMs <= 0) {
      throw new RangeError("Candle interval must be finite and positive");
    }
    this.candleIntervalMs = candleIntervalMs;
    this.candles = candles.map((candle) => ({ ...candle }));
    this.replay.load(this.candles);
    this.fundingEvents = this.normalizeFundingEvents(fundingEvents);
    this.markCandles = this.normalizeMarkCandles(markCandles);
    this.marksByTime = new Map(this.markCandles.map((mark) => [mark.time, mark]));
    this.accountOptions = { ...account };
    this.account = new PaperAccount(this.accountOptions);
  }

  snapshot(): ReplaySnapshot {
    return this.replay.snapshot();
  }

  accountSnapshot(): AccountSnapshot {
    return this.account.snapshot();
  }

  ordersSnapshot(): PaperOrder[] {
    return this.orders.map((order) => ({ ...order }));
  }

  activitySnapshot(): SessionActivity[] {
    return this.activities.map((item) => ({ ...item }));
  }

  play(): ReplaySnapshot {
    return this.replay.play();
  }

  pause(): ReplaySnapshot {
    return this.replay.pause();
  }

  setSpeed(speed: number): ReplaySnapshot {
    return this.replay.setSpeed(speed);
  }

  step(): ReplaySnapshot {
    const previousIndex = this.snapshot().index;
    const state = this.replay.step();
    if (state.index >= 0 && state.index !== previousIndex && state.candle) {
      this.processCandle(state.candle, state.index);
      this.applyJournalActionsAtIndex(state.index);
    }
    return state;
  }

  seek(index: number): ReplaySnapshot {
    if (!Number.isInteger(index) || index < -1 || index >= this.candles.length) {
      throw new RangeError("Replay index is outside the dataset");
    }

    this.replay.seek(-1);
    this.resetTradingState();
    this.fundingCursor = 0;
    this.journal.rewind();
    this.applyJournalActionsAtIndex(-1);
    for (let current = 0; current <= index; current += 1) {
      this.replay.seek(current - 1);
      const state = this.replay.step();
      if (state.candle) {
        this.processCandle(state.candle, current);
        this.applyJournalActionsAtIndex(current);
      }
    }
    return this.replay.seek(index);
  }

  submitOrder(order: OrderIntent): void {
    const state = this.snapshot();
    if (!state.candle) throw new Error("Start replay before placing an order");
    if (state.index >= this.candles.length - 1) throw new Error("Replay is at the last candle");
    this.recordUserAction({ kind: "submit", index: state.index, order: { ...order } });
  }

  closePosition(): void {
    if (!this.snapshot().candle || !this.account.snapshot().position) {
      throw new Error("No open position or replay price available");
    }
    this.recordUserAction({ kind: "close", index: this.snapshot().index });
  }

  cancelPendingOrders(): boolean {
    if (!this.orders.some((order) => order.status === "PENDING")) return false;
    this.recordUserAction({ kind: "cancel-pending", index: this.snapshot().index });
    return true;
  }

  resetAccount(): void {
    this.recordUserAction({ kind: "reset", index: this.snapshot().index });
  }

  private recordActivity(message: string, tone: SessionActivity["tone"] = "", timestamp = this.snapshot().timestamp): void {
    this.activities.unshift({ timestamp, message, tone });
    this.activities = this.activities.slice(0, 25);
  }

  private resetTradingState(): void {
    this.account = new PaperAccount(this.accountOptions);
    this.orders = [];
    this.activities = [];
    this.nextOrderId = 1;
    this.positionOpenedIndex = -1;
  }

  private markCandleFor(candle: Candle): MarkPriceCandle | null {
    return matchMarkCandle(candle, this.marksByTime);
  }

  private markPriceForCandle(candle: Candle): number {
    return this.markCandleFor(candle)?.close ?? candle.close;
  }

  private processPendingOrders(candle: Candle, index: number): void {
    for (const order of this.orders) {
      if (order.status !== "PENDING" || index <= order.createdIndex) continue;
      try {
        const fillPrice = resolveFillPrice(order, candle, index);
        if (fillPrice === null) continue;
        this.account.open({
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          price: fillPrice,
          leverage: order.leverage,
          stopLossPrice: order.stopLossPrice,
          takeProfitPrice: order.takeProfitPrice,
        });
        this.positionOpenedIndex = index;
        order.status = "FILLED";
        order.filledPrice = fillPrice;
        this.recordActivity(`FILLED #${order.id} ${order.side} ${order.quantity} @ ${this.money(fillPrice)}`, "positive");
      } catch (error) {
        order.status = "REJECTED";
        order.message = error instanceof Error ? error.message : String(error);
        this.recordActivity(`REJECTED #${order.id}: ${order.message}`, "negative");
      }
    }
  }

  private processFundingEvents(candle: Candle): void {
    while (this.fundingCursor < this.fundingEvents.length && this.fundingEvents[this.fundingCursor].fundingTime <= candle.time) {
      const event = this.fundingEvents[this.fundingCursor++];
      if (!this.account.snapshot().position) continue;
      const markPrice = this.validPrice(event.markPrice)
        ? event.markPrice
        : historicalMarkAt(event.fundingTime, this.markCandles, this.candleIntervalMs);
      if (markPrice === null) {
        this.recordActivity(
          "FUNDING SKIPPED — historical mark price unavailable at settlement; account totals unchanged",
          "",
          event.fundingTime,
        );
        continue;
      }
      const payment = this.account.applyFunding(event.fundingRate, markPrice);
      const flow = payment < 0 ? "paid" : "received";
      this.recordActivity(`FUNDING ${flow} ${this.money(Math.abs(payment))} · rate ${(event.fundingRate * 100).toFixed(4)}%`, payment < 0 ? "negative" : "positive", event.fundingTime);
    }
  }

  private processCandle(candle: Candle, index: number): void {
    this.processFundingEvents(candle);
    this.processPendingOrders(candle, index);
    const position = this.account.snapshot().position;
    if (position && index >= this.positionOpenedIndex) {
      const liquidationCandle = this.markCandleFor(candle) ?? candle;
      const liquidation = resolveLiquidationExit(
        position.side,
        liquidationCandle,
        index,
        this.positionOpenedIndex,
        this.account.snapshot().liquidationPrice,
      );
      if (liquidation) {
        this.account.close(liquidation.price);
        this.positionOpenedIndex = -1;
        this.recordActivity(`LIQUIDATION ${position.side} @ ${this.money(liquidation.price)}`, "negative");
      } else {
        const exit = resolveRiskExit(position, candle, index, this.positionOpenedIndex);
        if (exit) {
          this.account.close(exit.price);
          this.positionOpenedIndex = -1;
          this.recordActivity(`${exit.reason.replace("_", " ")} ${position.side} @ ${this.money(exit.price)}`, exit.reason === "STOP_LOSS" ? "negative" : "positive");
        }
      }
    }
    this.account.updateMark(this.markPriceForCandle(candle));
  }

  private applySessionAction(action: SessionAction): void {
    if (action.kind === "submit") {
      const order: PaperOrder = {
        ...action.order,
        id: this.nextOrderId++,
        createdIndex: action.index,
        status: "PENDING",
        filledPrice: null,
      };
      this.orders.push(order);
      this.recordActivity(`SUBMITTED #${order.id} ${order.side} ${order.type.toUpperCase()} ${order.quantity}`);
      return;
    }

    if (action.kind === "close") {
      const candle = action.index >= 0 ? this.candles[action.index] : null;
      if (!candle || !this.account.snapshot().position) return;
      const price = candle.close;
      const before = this.account.snapshot().walletBalance;
      this.account.close(price);
      this.positionOpenedIndex = -1;
      const walletDelta = this.account.snapshot().walletBalance - before;
      this.recordActivity(`CLOSED position @ ${this.money(price)} · wallet change ${this.money(walletDelta)}`, walletDelta >= 0 ? "positive" : "negative");
      return;
    }

    if (action.kind === "cancel-pending") {
      for (const order of this.orders.filter((item) => item.status === "PENDING")) {
        order.status = "CANCELLED";
        this.recordActivity(`CANCELLED #${order.id}`);
      }
      return;
    }

    this.resetTradingState();
    if (action.index >= 0 && this.candles[action.index]) {
      this.account.updateMark(this.markPriceForCandle(this.candles[action.index]));
    }
  }

  private applyJournalActionsAtIndex(index: number): void {
    for (const action of this.journal.takeAt(index)) this.applySessionAction(action);
  }

  private recordUserAction(action: SessionAction): void {
    this.journal.append(action, this.snapshot().index);
    this.applySessionAction(action);
  }

  private validPrice(value: number | null): value is number {
    return value !== null && Number.isFinite(value) && value > 0;
  }

  private normalizeFundingEvents(events: readonly HistoricalFunding[]): HistoricalFunding[] {
    const sorted = events.map((event) => ({ ...event })).sort((a, b) => a.fundingTime - b.fundingTime);
    const result: HistoricalFunding[] = [];
    for (const event of sorted) {
      if (!Number.isFinite(event.fundingTime) || event.fundingTime < 0) {
        throw new RangeError("Funding timestamp must be finite and non-negative");
      }
      if (!Number.isFinite(event.fundingRate)) throw new RangeError("Funding rate must be finite");
      if (event.markPrice !== null && !this.validPrice(event.markPrice)) event.markPrice = null;

      const previous = result[result.length - 1];
      if (previous?.fundingTime === event.fundingTime) {
        if (previous.fundingRate !== event.fundingRate || previous.markPrice !== event.markPrice) {
          throw new RangeError("Conflicting funding events share a settlement timestamp");
        }
        continue;
      }
      result.push(event);
    }
    return result;
  }

  private normalizeMarkCandles(candles: readonly MarkPriceCandle[]): MarkPriceCandle[] {
    const sorted = candles.map((candle) => ({ ...candle })).sort((a, b) => a.time - b.time);
    let previousTime = -1;
    for (const candle of sorted) {
      if (!Number.isFinite(candle.time) || candle.time < 0 || candle.time <= previousTime) {
        throw new RangeError("Mark-price candle timestamps must be finite, non-negative, and unique");
      }
      if (![candle.open, candle.high, candle.low, candle.close].every((price) => Number.isFinite(price) && price > 0)) {
        throw new RangeError("Mark-price candles must contain finite positive prices");
      }
      if (candle.high < Math.max(candle.open, candle.close, candle.low) || candle.low > Math.min(candle.open, candle.close, candle.high)) {
        throw new RangeError("Mark-price candle has an inconsistent OHLC range");
      }
      previousTime = candle.time;
    }
    return sorted;
  }

  private money(value: number): string {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
