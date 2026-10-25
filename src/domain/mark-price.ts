import type { Candle } from "./market";

export interface MarkPriceCandle {
  /** Unix time in milliseconds, marking the opening time of the mark-price candle. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Match a trade candle to the mark-price candle with the same opening timestamp. */
export function matchMarkCandle(
  tradeCandle: Pick<Candle, "time">,
  markCandles: ReadonlyMap<number, MarkPriceCandle>,
): MarkPriceCandle | null {
  return markCandles.get(tradeCandle.time) ?? null;
}

/**
 * Resolve an approximate historical mark at an event timestamp. An exact
 * candle boundary uses that candle's open; between boundaries the most recent
 * completed mark candle's close is used. No future mark price is consulted.
 */
export function historicalMarkAt(
  timestamp: number,
  sortedMarkCandles: readonly MarkPriceCandle[],
  fallback: number,
): number {
  if (!Number.isFinite(timestamp)) throw new RangeError("Timestamp must be finite");
  if (!Number.isFinite(fallback) || fallback <= 0) {
    throw new RangeError("Fallback price must be finite and positive");
  }

  let low = 0;
  let high = sortedMarkCandles.length - 1;
  let previous = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candle = sortedMarkCandles[middle];
    if (candle.time === timestamp) return candle.open;
    if (candle.time < timestamp) {
      previous = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return previous >= 0 ? sortedMarkCandles[previous].close : fallback;
}
