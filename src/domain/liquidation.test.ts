import { describe, expect, it } from "vitest";
import { resolveLiquidationExit } from "./liquidation";
import type { Candle } from "./market";

const bar: Candle = {
  time: 1_700_000_060_000,
  open: 100,
  high: 112,
  low: 88,
  close: 94,
  volume: 10,
};

describe("resolveLiquidationExit", () => {
  it("does not liquidate on the candle where a position opened", () => {
    expect(resolveLiquidationExit("LONG", bar, 5, 5, 90)).toBeNull();
  });

  it("liquidates a long at the threshold when the open is above it", () => {
    expect(resolveLiquidationExit("LONG", bar, 6, 5, 90)).toEqual({
      price: 90,
      reason: "LIQUIDATION",
    });
  });

  it("fills a long at the open if the candle gaps below liquidation", () => {
    expect(resolveLiquidationExit("LONG", { ...bar, open: 84, low: 80 }, 6, 5, 90)).toEqual({
      price: 84,
      reason: "LIQUIDATION",
    });
  });

  it("liquidates a short at its threshold when high crosses it", () => {
    expect(resolveLiquidationExit("SHORT", { ...bar, high: 115 }, 6, 5, 110)).toEqual({
      price: 110,
      reason: "LIQUIDATION",
    });
  });

  it("fills a short at the open if the candle gaps above liquidation", () => {
    expect(resolveLiquidationExit("SHORT", { ...bar, open: 116, high: 120 }, 6, 5, 110)).toEqual({
      price: 116,
      reason: "LIQUIDATION",
    });
  });

  it("accepts mark-price OHLC independently of the trade candle", () => {
    expect(resolveLiquidationExit("LONG", { open: 98, high: 99, low: 89 }, 6, 5, 90)).toEqual({
      price: 90,
      reason: "LIQUIDATION",
    });
  });

  it("does nothing when the liquidation threshold is not crossed or is unavailable", () => {
    expect(resolveLiquidationExit("LONG", { ...bar, low: 92 }, 6, 5, 90)).toBeNull();
    expect(resolveLiquidationExit("LONG", bar, 6, 5, null)).toBeNull();
  });
});
