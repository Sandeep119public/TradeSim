export interface Candle {
  /** Unix time in milliseconds, marking the opening time of this candle. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function validateCandles(candles: readonly Candle[]): void {
  if (candles.length === 0) throw new Error("Dataset must contain at least one candle");

  let previousTime = -Infinity;
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    if (!Number.isSafeInteger(candle.time)) {
      throw new Error(`Candle ${i} timestamp must be a safe integer millisecond value`);
    }
    const values = [candle.open, candle.high, candle.low, candle.close, candle.volume];
    if (!values.every(Number.isFinite)) throw new Error(`Candle ${i} contains a non-finite value`);
    if (candle.time <= previousTime) throw new Error(`Candle timestamps must be strictly increasing (index ${i})`);
    if (candle.time < 0) throw new Error(`Candle ${i} has a negative timestamp`);
    if (!Number.isFinite(new Date(candle.time).getTime())) {
      throw new Error(`Candle ${i} timestamp is outside the supported date range`);
    }
    if ([candle.open, candle.high, candle.low, candle.close].some((n) => n <= 0)) {
      throw new Error(`Candle ${i} contains a non-positive price`);
    }
    if (candle.volume < 0) throw new Error(`Candle ${i} contains negative volume`);
    if (candle.high < Math.max(candle.open, candle.close, candle.low)) {
      throw new Error(`Candle ${i} has an inconsistent high`);
    }
    if (candle.low > Math.min(candle.open, candle.close, candle.high)) {
      throw new Error(`Candle ${i} has an inconsistent low`);
    }
    previousTime = candle.time;
  }
}
