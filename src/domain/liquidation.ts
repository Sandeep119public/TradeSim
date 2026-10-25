import type { Candle } from "./market";

export interface LiquidationExit {
  price: number;
  reason: "LIQUIDATION";
}

/**
 * OHLC approximation of a liquidation trigger.
 *
 * The caller should pass mark-price OHLC when available; trade-candle OHLC is
 * only a fallback proxy. Gaps through the threshold fill at the candle open
 * if that is worse. The opening candle is eligible after the fill; with an
 * intrabar limit fill, the full candle range is conservatively considered
 * because OHLC data cannot establish the sequence. Fixed maintenance-margin
 * tiers remain approximate.
 */
export function resolveLiquidationExit(
  side: "LONG" | "SHORT",
  candle: Pick<Candle, "open" | "high" | "low">,
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
  if (candleIndex < openedIndex) return null;

  if (side === "LONG") {
    if (candle.low > liquidationPrice) return null;
    return { price: candle.open < liquidationPrice ? candle.open : liquidationPrice, reason: "LIQUIDATION" };
  }
  if (candle.high < liquidationPrice) return null;
  return { price: candle.open > liquidationPrice ? candle.open : liquidationPrice, reason: "LIQUIDATION" };
}
