import { describe, expect, it } from "vitest";
import { ReplayEngine } from "./replay";
import type { Candle } from "./market";

const candles: Candle[] = [
  { time: 1_700_000_000_000, open: 100, high: 105, low: 99, close: 103, volume: 10 },
  { time: 1_700_000_060_000, open: 103, high: 106, low: 101, close: 102, volume: 12 },
];

describe("ReplayEngine", () => {
  it("loads data without exposing a future candle", () => {
    const engine = new ReplayEngine();
    const state = engine.load(candles);
    expect(state.index).toBe(-1);
    expect(state.candle).toBeNull();
    expect(engine.step().candle).toEqual(candles[0]);
  });

  it("steps and seeks deterministically", () => {
    const engine = new ReplayEngine();
    engine.load(candles);
    engine.step();
    expect(engine.step().candle).toEqual(candles[1]);
    expect(engine.seek(0).candle).toEqual(candles[0]);
    expect(engine.seek(-1).timestamp).toBeNull();
  });

  it("rejects invalid indices and speeds", () => {
    const engine = new ReplayEngine();
    engine.load(candles);
    expect(() => engine.seek(99)).toThrow(RangeError);
    expect(() => engine.setSpeed(0)).toThrow(RangeError);
  });

  it("remains playing across automatic steps until the final candle", () => {
    const engine = new ReplayEngine();
    engine.load(candles);
    expect(engine.play().status).toBe("playing");
    expect(engine.step().status).toBe("playing");
    expect(engine.step().status).toBe("ended");
  });

  it("rejects non-increasing timestamps", () => {
    const engine = new ReplayEngine();
    expect(() => engine.load([candles[0], { ...candles[1], time: candles[0].time }])).toThrow(/timestamps/);
  });
});
