import { validateCandles, type Candle } from "./market";

export type ReplayStatus = "ready" | "playing" | "paused" | "ended";

export interface ReplaySnapshot {
  status: ReplayStatus;
  index: number;
  timestamp: number | null;
  speed: number;
  total: number;
  candle: Candle | null;
}

/** Clock-independent replay core: timers belong to the UI; event order belongs here. */
export class ReplayEngine {
  private candles: readonly Candle[] = [];
  private cursor = -1;
  private status: ReplayStatus = "ready";
  private speed = 1;

  load(candles: readonly Candle[]): ReplaySnapshot {
    validateCandles(candles);
    this.candles = candles.map((candle) => Object.freeze({ ...candle }));
    this.cursor = -1;
    this.status = "ready";
    return this.snapshot();
  }

  play(): ReplaySnapshot {
    if (this.candles.length === 0) throw new Error("Load a dataset before starting replay");
    this.status = this.cursor >= this.candles.length - 1 ? "ended" : "playing";
    return this.snapshot();
  }

  pause(): ReplaySnapshot {
    if (this.status === "playing") this.status = "paused";
    return this.snapshot();
  }

  step(): ReplaySnapshot {
    if (this.candles.length === 0) throw new Error("Load a dataset before stepping replay");
    if (this.cursor + 1 >= this.candles.length) {
      this.status = "ended";
      return this.snapshot();
    }
    const wasPlaying = this.status === "playing";
    this.cursor += 1;
    this.status = this.cursor === this.candles.length - 1
      ? "ended"
      : wasPlaying ? "playing" : "paused";
    return this.snapshot();
  }

  seek(index: number): ReplaySnapshot {
    if (!Number.isInteger(index) || index < -1 || index >= this.candles.length) {
      throw new RangeError("Replay index is outside the dataset");
    }
    this.cursor = index;
    this.status = index === this.candles.length - 1 ? "ended" : "paused";
    return this.snapshot();
  }

  setSpeed(speed: number): ReplaySnapshot {
    if (!Number.isFinite(speed) || speed <= 0 || speed > 100) {
      throw new RangeError("Replay speed must be greater than 0 and at most 100");
    }
    this.speed = speed;
    return this.snapshot();
  }

  snapshot(): ReplaySnapshot {
    const candle = this.cursor >= 0 ? this.candles[this.cursor] : null;
    return {
      status: this.status,
      index: this.cursor,
      timestamp: candle?.time ?? null,
      speed: this.speed,
      total: this.candles.length,
      candle: candle ? { ...candle } : null,
    };
  }
}
