import type { Candle } from "./market";
import type { Side } from "./paper-account";

export type OrderType = "market" | "limit";

export interface SimulatedOrder {
  type: OrderType;
  side: Side;
  limitPrice: number | null;
  createdIndex: number;
}

/**
 * Resolve a candle-based fill, if one is eligible.
 *
 * Orders cannot consume the OHLC range of the candle on which they were
 * submitted. Market orders fill at the next eligible bar open. Limits use
 * a documented OHLC touch/gap approximation and do not model queue priority.
 */
export function resolveFillPrice(
  order: SimulatedOrder,
  candle: Candle,
  candleIndex: number,
): number | null {
  if (!Number.isInteger(candleIndex) || candleIndex < 0) {
    throw new RangeError("Candle index must be a non-negative integer");
  }
  if (!Number.isInteger(order.createdIndex) || order.createdIndex < -1) {
    throw new RangeError("Order createdIndex must be an integer greater than or equal to -1");
  }
  if (candleIndex <= order.createdIndex) return null;

  if (order.type === "market") return candle.open;
  if (order.type !== "limit") throw new Error(`Unsupported order type: ${String(order.type)}`);
  if (order.limitPrice === null || !Number.isFinite(order.limitPrice) || order.limitPrice <= 0) {
    throw new RangeError("Limit order requires a finite positive limit price");
  }

  if (order.side === "LONG") {
    if (candle.low > order.limitPrice) return null;
    return Math.min(order.limitPrice, candle.open);
  }
  if (candle.high < order.limitPrice) return null;
  return Math.max(order.limitPrice, candle.open);
}
