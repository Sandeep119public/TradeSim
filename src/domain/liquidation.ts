import type { Candle } from "./market";

export interface LiquidationExit {
  price: number;
  reason: "LIQUIDATION";
}

/**
 * OHLC approximation of a liquidation trigger.
 *
 * Uses the provided liquidation threshold as if the candle's high/low were
 * mark-price extrema. Gaps through the threshold fill at the candle open if
 * that is worse. This is not Binance-tier-accurate liquidation simulation.
 */
export function resolveLiquidationExit(
  side: "LONG" | "SHORT",
  candle: Candle,
  candleIndex: number,
  openedIndex: number,
  liquidationPrice: number | null,
): LiquidationExit | null {
  if (!Number.isInteger(candleIndex) || candleIndex < 0) {
    throw new RangeError("Candle index must be a non-negative integer");
  }
  if (!Number.isInteger(openedIndex) || openedIndex < -1) {
    throw new RangeError("openedIndex must be an integer greater than or equal to -1");
  }
  if (liquidationPrice === null) return null;
  if (!Number.isFinite(liquidationPrice) || liquidationPrice <= 0) {
    throw new RangeError("Liquidation price must be finite and positive");
  }
  if (candleIndex <= openedIndex) return null;

  if (side === "LONG") {
    if (candle.low > liquidationPrice) return null;
    return { price: candle.open < liquidationPrice ? candle.open : liquidationPrice, reason: "LIQUIDATION" };
  }
  if (candle.high < liquidationPrice) return null;
  return { price: candle.open > liquidationPrice ? candle.open : liquidationPrice, reason: "LIQUIDATION" };
}
