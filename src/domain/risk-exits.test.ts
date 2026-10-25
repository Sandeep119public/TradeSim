import { describe, expect, it } from "vitest";
import { resolveRiskExit } from "./risk-exits";
import type { Candle } from "./market";

const bar: Candle = {
  time: 1_700_000_060_000,
  open: 100,
  high: 115,
  low: 85,
  close: 105,
  volume: 20,
};

describe("resolveRiskExit", () => {
  it("does not trigger on the candle where a position opened", () => {
    expect(resolveRiskExit(
      { side: "LONG", stopLossPrice: 95, takeProfitPrice: 110 },
      bar,
      10,
      10,
    )).toBeNull();
  });

  it("triggers a long stop loss at its level when the open is not beyond it", () => {
    expect(resolveRiskExit(
      { side: "LONG", stopLossPrice: 95, takeProfitPrice: null },
      { ...bar, open: 100, low: 92 },
      11,
      10,
    )).toEqual({ price: 95, reason: "STOP_LOSS" });
  });

  it("fills a long stop at the open when price gaps below it", () => {
    expect(resolveRiskExit(
      { side: "LONG", stopLossPrice: 95, takeProfitPrice: null },
      { ...bar, open: 90, low: 87 },
      11,
      10,
    )).toEqual({ price: 90, reason: "STOP_LOSS" });
  });

  it("fills a short stop at the open when price gaps above it", () => {
    expect(resolveRiskExit(
      { side: "SHORT", stopLossPrice: 110, takeProfitPrice: null },
      { ...bar, open: 114, high: 118 },
      11,
      10,
    )).toEqual({ price: 114, reason: "STOP_LOSS" });
  });

  it("gives a long take profit opening-price improvement on an upward gap", () => {
    expect(resolveRiskExit(
      { side: "LONG", stopLossPrice: null, takeProfitPrice: 110 },
      { ...bar, open: 112, high: 116 },
      11,
      10,
    )).toEqual({ price: 112, reason: "TAKE_PROFIT" });
  });

  it("gives a short take profit opening-price improvement on a downward gap", () => {
    expect(resolveRiskExit(
      { side: "SHORT", stopLossPrice: null, takeProfitPrice: 90 },
      { ...bar, open: 88, low: 84 },
      11,
      10,
    )).toEqual({ price: 88, reason: "TAKE_PROFIT" });
  });

  it("prefers stop loss when one OHLC candle touches both stop and target", () => {
    expect(resolveRiskExit(
      { side: "LONG", stopLossPrice: 95, takeProfitPrice: 110 },
      bar,
      11,
      10,
    )).toEqual({ price: 95, reason: "STOP_LOSS" });
  });

  it("does nothing when neither level is touched", () => {
    expect(resolveRiskExit(
      { side: "LONG", stopLossPrice: 95, takeProfitPrice: 110 },
      { ...bar, high: 108, low: 98 },
      11,
      10,
    )).toBeNull();
  });
});
