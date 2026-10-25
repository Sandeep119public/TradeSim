import { describe, expect, it } from "vitest";
import { resolveFillPrice, type SimulatedOrder } from "./matching";
import type { Candle } from "./market";

const bar: Candle = {
  time: 1_700_000_060_000,
  open: 100,
  high: 112,
  low: 94,
  close: 108,
  volume: 15,
};

describe("resolveFillPrice", () => {
  it("does not fill against the candle that created the order", () => {
    const order: SimulatedOrder = { type: "market", side: "LONG", limitPrice: null, createdIndex: 5 };
    expect(resolveFillPrice(order, bar, 5)).toBeNull();
  });

  it("fills a market order at the next eligible candle open", () => {
    const order: SimulatedOrder = { type: "market", side: "LONG", limitPrice: null, createdIndex: 5 };
    expect(resolveFillPrice(order, bar, 6)).toBe(100);
  });

  it("fills a buy limit at the limit when the candle crosses it", () => {
    const order: SimulatedOrder = { type: "limit", side: "LONG", limitPrice: 97, createdIndex: 5 };
    expect(resolveFillPrice(order, bar, 6)).toBe(97);
  });

  it("gives a buy limit a better opening price after a downward gap", () => {
    const order: SimulatedOrder = { type: "limit", side: "LONG", limitPrice: 97, createdIndex: 5 };
    expect(resolveFillPrice(order, { ...bar, open: 92, high: 103, low: 90, close: 99 }, 6)).toBe(92);
  });

  it("fills a sell limit at a better opening price after an upward gap", () => {
    const order: SimulatedOrder = { type: "limit", side: "SHORT", limitPrice: 110, createdIndex: 5 };
    expect(resolveFillPrice(order, { ...bar, open: 114, high: 118, low: 109, close: 115 }, 6)).toBe(114);
  });

  it("leaves an untouched limit order pending", () => {
    const order: SimulatedOrder = { type: "limit", side: "SHORT", limitPrice: 115, createdIndex: 5 };
    expect(resolveFillPrice(order, bar, 6)).toBeNull();
  });

  it("rejects a limit order without a usable price", () => {
    const order: SimulatedOrder = { type: "limit", side: "LONG", limitPrice: null, createdIndex: 5 };
    expect(() => resolveFillPrice(order, bar, 6)).toThrow(/limit price/i);
  });
});
