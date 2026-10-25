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
 * candle boundary uses that candle's open. Inside an unfinished candle, its
 * open is the latest observation known so far; otherwise the latest completed
 * candle's close is used. Returns null when no observation was available by the
 * event time; callers must not substitute an unfinished candle close.
 */
export function historicalMarkAt(
  timestamp: number,
  sortedMarkCandles: readonly MarkPriceCandle[],
  intervalMs: number,
): number | null {
  if (!Number.isFinite(timestamp)) throw new RangeError("Timestamp must be finite");
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("Candle interval must be finite and positive");
  }

  let low = 0;
  let high = sortedMarkCandles.length - 1;
  let latestKnown = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candle = sortedMarkCandles[middle];
    if (candle.time === timestamp) return candle.open;
    if (candle.time <= timestamp) {
      latestKnown = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (latestKnown < 0) return null;
  const candle = sortedMarkCandles[latestKnown];
  return candle.time + intervalMs <= timestamp ? candle.close : candle.open;
}
