import type { Candle } from "./market";

export type RiskExitReason = "STOP_LOSS" | "TAKE_PROFIT";

export interface RiskManagedPosition {
  side: "LONG" | "SHORT";
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
}

export interface RiskExit {
  price: number;
  reason: RiskExitReason;
}

/**
 * Resolves attached SL/TP against OHLC candles.
 *
 * Conservative assumptions:
 * - evaluate the opening candle after the fill; for an intrabar limit fill,
 *   conservatively apply its full OHLC range because the path is unknown;
 * - when SL and TP are both touched in one OHLC candle, stop loss wins;
 * - stop gaps fill at the open when that is worse than the stop trigger;
 * - take-profit gaps fill at the open when it is better than the target;
 * - intrabar order, spread, queue priority, and slippage beyond the gap model
 *   are unknown in OHLC data.
 */
export function resolveRiskExit(
  position: RiskManagedPosition,
  candle: Candle,
  candleIndex: number,
  openedIndex: number,
): RiskExit | null {
  if (!Number.isInteger(candleIndex) || candleIndex < 0) {
    throw new RangeError("Candle index must be a non-negative integer");
  }
  if (!Number.isInteger(openedIndex) || openedIndex < -1) {
    throw new RangeError("openedIndex must be an integer greater than or equal to -1");
  }
  if (candleIndex < openedIndex) return null;

  const stop = position.stopLossPrice;
  const target = position.takeProfitPrice;
  if (stop !== null && (!Number.isFinite(stop) || stop <= 0)) {
    throw new RangeError("Stop-loss price must be finite and positive");
  }
  if (target !== null && (!Number.isFinite(target) || target <= 0)) {
    throw new RangeError("Take-profit price must be finite and positive");
  }

  const isLong = position.side === "LONG";
  const stopTouched = stop !== null && (isLong ? candle.low <= stop : candle.high >= stop);
  const targetTouched = target !== null && (isLong ? candle.high >= target : candle.low <= target);

  // A candle does not encode whether its high or low happened first. Prefer
  // the risk-protective exit if both levels were crossed inside the same bar.
  if (stopTouched) {
    const gapIsWorse = isLong ? candle.open < stop! : candle.open > stop!;
    return { price: gapIsWorse ? candle.open : stop!, reason: "STOP_LOSS" };
  }
  if (targetTouched) {
    const gapIsBetter = isLong ? candle.open > target! : candle.open < target!;
    return { price: gapIsBetter ? candle.open : target!, reason: "TAKE_PROFIT" };
  }
  return null;
}
