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
    expect(historicalMarkAt(120_000, marks, 50, 60_000)).toBe(102);
  });

  it("uses the latest completed mark close without looking ahead", () => {
    expect(historicalMarkAt(150_000, marks, 50, 60_000)).toBe(102);
    expect(historicalMarkAt(180_000, marks, 50, 60_000)).toBe(104);
    expect(historicalMarkAt(30_000, marks, 50, 60_000)).toBe(50);
  });

  it("rejects an invalid fallback", () => {
    expect(() => historicalMarkAt(1, marks, 0, 60_000)).toThrow(RangeError);
  });
});
