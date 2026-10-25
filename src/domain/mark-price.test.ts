import { describe, expect, it } from "vitest";
import { historicalMarkAt, matchMarkCandle, type MarkPriceCandle } from "./mark-price";

const marks: MarkPriceCandle[] = [
  { time: 60_000, open: 100, high: 103, low: 98, close: 102 },
  { time: 120_000, open: 102, high: 105, low: 101, close: 104 },
];

describe("historical mark price helpers", () => {
  it("matches candles by exact open time", () => {
    const byTime = new Map(marks.map((candle) => [candle.time, candle]));
    expect(matchMarkCandle({ time: 120_000 }, byTime)).toEqual(marks[1]);
    expect(matchMarkCandle({ time: 90_000 }, byTime)).toBeNull();
  });

  it("uses the mark open at an exact event boundary", () => {
    expect(historicalMarkAt(120_000, marks, 60_000)).toBe(102);
  });

  it("uses the latest completed mark close without looking ahead", () => {
    expect(historicalMarkAt(150_000, marks, 60_000)).toBe(102);
    expect(historicalMarkAt(180_000, marks, 60_000)).toBe(104);
    expect(historicalMarkAt(30_000, marks, 60_000)).toBeNull();
  });

  it("may use an unfinished candle's already-known open, but never its future close", () => {
    const unfinished = [
      { time: 60_000, open: 100, high: 205, low: 95, close: 200 },
    ];
    expect(historicalMarkAt(90_000, unfinished, 60_000)).toBe(100);
  });

  it("returns unavailable when no mark observation was available by settlement", () => {
    expect(historicalMarkAt(0, [], 60_000)).toBeNull();
  });

  it("uses the latest completed candle across a missing mark candle, not the gap candle's partial range", () => {
    const withGap: MarkPriceCandle[] = [
      marks[0],
      { time: 180_000, open: 104, high: 109, low: 103, close: 108 },
    ];
    expect(historicalMarkAt(150_000, withGap, 60_000)).toBe(102);
    expect(historicalMarkAt(240_000, withGap, 60_000)).toBe(108);
  });

  it("rejects an invalid interval", () => {
    expect(() => historicalMarkAt(1, marks, 0)).toThrow(RangeError);
  });
});
