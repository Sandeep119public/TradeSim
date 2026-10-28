import { describe, expect, it } from "vitest";
import { validateCandles, type Candle } from "./market";

const candle = (time: number, values: Partial<Candle> = {}): Candle => ({
  time,
  open: 100,
  high: 105,
  low: 95,
  close: 101,
  volume: 10,
  ...values,
});

describe("validateCandles", () => {
  it("accepts consistent, strictly ordered OHLCV data", () => {
    expect(() => validateCandles([candle(1), candle(2)])).not.toThrow();
  });

  it("rejects empty, malformed, duplicate, and out-of-order datasets", () => {
    expect(() => validateCandles([])).toThrow(/at least one candle/);
    expect(() => validateCandles([candle(1, { close: Number.NaN })])).toThrow(/non-finite/);
    expect(() => validateCandles([candle(1), candle(1)])).toThrow(/strictly increasing/);
    expect(() => validateCandles([candle(2), candle(1)])).toThrow(/strictly increasing/);
  });

  it("rejects invalid timestamps, prices, volume, and OHLC ranges", () => {
    expect(() => validateCandles([candle(-1)])).toThrow(/negative timestamp/);
    expect(() => validateCandles([candle(1.5)])).toThrow(/safe integer millisecond/);
    expect(() => validateCandles([candle(Number.MAX_SAFE_INTEGER + 1)])).toThrow(/safe integer millisecond/);
    expect(() => validateCandles([candle(8_640_000_000_000_001)])).toThrow(/supported date range/);
    expect(() => validateCandles([candle(1, { open: 0 })])).toThrow(/non-positive price/);
    expect(() => validateCandles([candle(1, { volume: -1 })])).toThrow(/negative volume/);
    expect(() => validateCandles([candle(1, { high: 99 })])).toThrow(/inconsistent high/);
    expect(() => validateCandles([candle(1, { low: 102 })])).toThrow(/inconsistent low/);
  });
});
