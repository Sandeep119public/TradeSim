import { validateCandles, type Candle } from "./market";
import type { MarkPriceCandle } from "./mark-price";

export const BINANCE_PAGE_LIMIT = 1_000;
export const MAX_REPLAY_CANDLES = 100_000;

export type SupportedInterval = "1m" | "5m" | "15m" | "1h";

export function intervalToMs(interval: string): number {
  const intervals: Record<SupportedInterval, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
  };
  const value = intervals[interval as SupportedInterval];
  if (!value) throw new RangeError("Unsupported interval: " + interval);
  return value;
}

export interface PageProgress {
  dataset: "trade candles" | "mark-price candles" | "funding history";
  page: number;
  records: number;
}

export type HistoricalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type Sleep = (milliseconds: number) => Promise<void>;

export interface FetchPagedRowsOptions<T> {
  endpoint: string;
  params: Record<string, string>;
  startTime: number;
  endTime: number;
  limit: number;
  cursorStepMs: number;
  maxRecords?: number;
  maxRetries?: number;
  timestamp: (row: T) => number;
  key?: (row: T) => string;
  fetchImpl?: HistoricalFetch;
  sleep?: Sleep;
  dataset: PageProgress["dataset"];
  onProgress?: (progress: PageProgress) => void;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120_000, seconds * 1_000);
    const absolute = Date.parse(retryAfter);
    if (Number.isFinite(absolute)) return Math.min(120_000, Math.max(0, absolute - Date.now()));
  }
  if (response.status === 418) return 60_000;
  return Math.min(30_000, 500 * 2 ** attempt);
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 418 || status === 429 || status === 500 ||
    status === 502 || status === 503 || status === 504;
}

async function requestJson(
  url: URL,
  fetchImpl: HistoricalFetch,
  sleep: Sleep,
  maxRetries: number,
): Promise<unknown> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { accept: "application/json" } });
    } catch (error) {
      if (attempt >= maxRetries) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error("Network request failed after " + (attempt + 1) + " attempt(s): " + detail);
      }
      await sleep(Math.min(30_000, 500 * 2 ** attempt));
      continue;
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error("Binance returned invalid JSON: " + detail);
      }
    }

    if (!retryableStatus(response.status) || attempt >= maxRetries) {
      throw new Error("Binance returned HTTP " + response.status + " for " + url.pathname);
    }

    await sleep(retryDelay(response, attempt));
  }

  throw new Error("Historical data request failed unexpectedly");
}

/**
 * Fetch an inclusive timestamp range in pages. Candle endpoints advance by
 * one candle interval; funding history advances by one millisecond after the
 * final event because its timestamps are irregular. The response cursor must
 * advance after every full page or the loader fails rather than looping.
 */
export async function fetchPagedRows<T>({
  endpoint,
  params,
  startTime,
  endTime,
  limit,
  cursorStepMs,
  maxRecords = MAX_REPLAY_CANDLES,
  maxRetries = 3,
  timestamp,
  key = (row) => String(timestamp(row)),
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  dataset,
  onProgress,
}: FetchPagedRowsOptions<T>): Promise<T[]> {
  if (!Number.isSafeInteger(startTime) || startTime < 0) throw new RangeError("startTime must be a non-negative integer timestamp");
  if (!Number.isSafeInteger(endTime) || endTime < startTime) throw new RangeError("endTime must be an integer timestamp at or after startTime");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError("Page limit must be between 1 and 1000");
  if (!Number.isFinite(cursorStepMs) || cursorStepMs < 1) throw new RangeError("Cursor step must be at least 1 millisecond");
  if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new RangeError("maxRecords must be a positive integer");
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) throw new RangeError("maxRetries must be an integer from 0 to 10");

  const rowsByKey = new Map<string, T>();
  let cursor = startTime;
  let page = 0;

  while (cursor <= endTime) {
    const url = new URL(endpoint);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endTime));
    url.searchParams.set("limit", String(limit));

    const payload = await requestJson(url, fetchImpl, sleep, maxRetries);
    if (!Array.isArray(payload)) throw new Error("Unexpected " + dataset + " response: expected an array");
    const pageRows = payload as T[];
    if (pageRows.length === 0) break;

    let latestTimestamp = -Infinity;
    for (const row of pageRows) {
      const rowTime = timestamp(row);
      if (!Number.isSafeInteger(rowTime) || rowTime < 0) {
        throw new Error("Invalid timestamp in " + dataset + " response");
      }
      if (rowTime < cursor || rowTime > endTime) continue;
      latestTimestamp = Math.max(latestTimestamp, rowTime);
      rowsByKey.set(key(row), row);
      if (rowsByKey.size > maxRecords) {
        throw new RangeError("Selected range exceeds the " + maxRecords.toLocaleString("en-US") + " record limit; narrow the date range");
      }
    }

    page += 1;
    onProgress?.({ dataset, page, records: rowsByKey.size });

    if (pageRows.length < limit) break;
    if (!Number.isFinite(latestTimestamp)) {
      throw new Error("Binance pagination made no progress for " + dataset);
    }
    const nextCursor = latestTimestamp + cursorStepMs;
    if (nextCursor <= cursor) throw new Error("Binance pagination cursor did not advance for " + dataset);
    if (nextCursor > endTime) break;
    cursor = nextCursor;
  }

  return [...rowsByKey.values()].sort((a, b) => timestamp(a) - timestamp(b));
}

export interface CandleGapReport {
  gapTransitions: number;
  estimatedMissingCandles: number;
}

export function inspectCandleGaps(candles: readonly Pick<Candle, "time">[], intervalMs: number): CandleGapReport {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError("Candle interval must be positive");
  let gapTransitions = 0;
  let estimatedMissingCandles = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const delta = candles[index].time - candles[index - 1].time;
    if (!Number.isFinite(delta) || delta <= 0) throw new Error("Candle timestamps must be strictly increasing");
    if (delta !== intervalMs) {
      gapTransitions += 1;
      estimatedMissingCandles += Math.max(0, Math.round(delta / intervalMs) - 1);
    }
  }
  return { gapTransitions, estimatedMissingCandles };
}

export interface HistoricalFunding {
  fundingTime: number;
  fundingRate: number;
  markPrice: number | null;
}

export interface BinanceHistoricalDataOptions {
  symbol: string;
  interval: SupportedInterval;
  startTime: number;
  endTime: number;
  nowMs?: number;
  maxCandles?: number;
  maxRetries?: number;
  fetchImpl?: HistoricalFetch;
  sleep?: Sleep;
  onProgress?: (progress: PageProgress) => void;
}

export interface BinanceHistoricalData {
  candles: Candle[];
  funding: HistoricalFunding[];
  marks: MarkPriceCandle[];
  gapReport: CandleGapReport;
  warnings: string[];
  startTime: number;
  endTime: number;
}

function parseCandleRow(row: unknown, index: number): Candle {
  if (!Array.isArray(row) || row.length < 6) throw new Error("Invalid Binance kline row at index " + index);
  const candle: Candle = {
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
  if (![candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)) {
    throw new Error("Non-finite value in Binance kline row " + index);
  }
  return candle;
}

function parseMarkRow(row: unknown, index: number): MarkPriceCandle {
  if (!Array.isArray(row) || row.length < 5) throw new Error("Invalid Binance mark-price row at index " + index);
  const mark: MarkPriceCandle = {
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
  };
  if (![mark.time, mark.open, mark.high, mark.low, mark.close].every(Number.isFinite)) {
    throw new Error("Non-finite value in Binance mark-price row " + index);
  }
  if (mark.time < 0 || [mark.open, mark.high, mark.low, mark.close].some((price) => price <= 0) ||
      mark.high < Math.max(mark.open, mark.close, mark.low) ||
      mark.low > Math.min(mark.open, mark.close, mark.high)) {
    throw new Error("Invalid OHLC values in Binance mark-price row " + index);
  }
  return mark;
}

function parseFundingRow(row: unknown, index: number): HistoricalFunding & { rateType: string } {
  if (row === null || typeof row !== "object") throw new Error("Invalid funding row at index " + index);
  const record = row as Record<string, unknown>;
  const fundingTime = Number(record.fundingTime);
  const fundingRate = Number(record.fundingRate);
  const rawMark = Number(record.markPrice);
  if (!Number.isSafeInteger(fundingTime) || fundingTime < 0 || !Number.isFinite(fundingRate)) {
    throw new Error("Invalid funding fields in row " + index);
  }
  return {
    fundingTime,
    fundingRate,
    markPrice: Number.isFinite(rawMark) && rawMark > 0 ? rawMark : null,
    rateType: typeof record.rateType === "string" ? record.rateType : "Regular",
  };
}

export async function loadBinanceHistoricalData({
  symbol,
  interval,
  startTime,
  endTime,
  nowMs = Date.now(),
  maxCandles = MAX_REPLAY_CANDLES,
  maxRetries = 3,
  fetchImpl = fetch,
  sleep,
  onProgress,
}: BinanceHistoricalDataOptions): Promise<BinanceHistoricalData> {
  if (!symbol.trim()) throw new Error("Symbol is required");
  if (!Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime) || startTime < 0 || endTime < startTime) {
    throw new RangeError("Choose a valid start and end date/time");
  }
  if (!Number.isFinite(nowMs)) throw new RangeError("nowMs must be finite");
  if (!Number.isInteger(maxCandles) || maxCandles < 1) throw new RangeError("maxCandles must be a positive integer");
  const intervalMs = intervalToMs(interval);
  // Candle opens are interval-aligned. Count those actual slots, not an
  // approximate duration-based count, so off-boundary times are handled safely.
  const firstCandleTime = Math.ceil(startTime / intervalMs) * intervalMs;
  const lastCandleTime = Math.floor(endTime / intervalMs) * intervalMs;
  const requestedSlots = lastCandleTime >= firstCandleTime
    ? Math.floor((lastCandleTime - firstCandleTime) / intervalMs) + 1
    : 0;
  if (requestedSlots > maxCandles) {
    throw new RangeError("Selected range exceeds the " + maxCandles.toLocaleString("en-US") + " candle safety limit; narrow the date range");
  }

  const commonParams = { symbol, interval };
  const candlesRows = await fetchPagedRows<unknown[]>({
    endpoint: "https://fapi.binance.com/fapi/v1/klines",
    params: commonParams,
    startTime,
    endTime,
    limit: BINANCE_PAGE_LIMIT,
    cursorStepMs: intervalMs,
    maxRecords: maxCandles,
    maxRetries,
    timestamp: (row) => Number(row[0]),
    fetchImpl,
    sleep,
    dataset: "trade candles",
    onProgress,
  });

  const candles = candlesRows.map(parseCandleRow).filter((candle) =>
    candle.time >= startTime && candle.time <= endTime && candle.time + intervalMs <= nowMs
  );
  if (candles.length === 0) throw new Error("No fully closed trade candles are available in the selected range");
  validateCandles(candles);
  const gapReport = inspectCandleGaps(candles, intervalMs);
  const warnings: string[] = [];
  if (gapReport.gapTransitions > 0) {
    warnings.push(
      gapReport.gapTransitions + " candle timestamp spacing issue(s) detected; approximately " +
      gapReport.estimatedMissingCandles + " candle slot(s) appear to be missing. Replay preserves the gap and does not fabricate candles."
    );
  }

  let marks: MarkPriceCandle[] = [];
  try {
    const markRows = await fetchPagedRows<unknown[]>({
      endpoint: "https://fapi.binance.com/fapi/v1/markPriceKlines",
      params: commonParams,
      startTime,
      endTime,
      limit: BINANCE_PAGE_LIMIT,
      cursorStepMs: intervalMs,
      maxRecords: maxCandles,
      maxRetries,
      timestamp: (row) => Number(row[0]),
      fetchImpl,
      sleep,
      dataset: "mark-price candles",
      onProgress,
    });
    marks = markRows.map(parseMarkRow).filter((mark) =>
      mark.time >= startTime && mark.time <= endTime && mark.time + intervalMs <= nowMs
    );
    const availableTimes = new Set(marks.map((mark) => mark.time));
    const aligned = candles.filter((candle) => availableTimes.has(candle.time)).length;
    if (aligned !== candles.length) {
      warnings.push(aligned + "/" + candles.length + " candle-aligned mark-price candles loaded; missing mark candles use trade-price fallback for mark-to-market/liquidation.");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnings.push("Historical mark-price candles unavailable: " + detail + ". Trade prices will be used as a fallback for mark-to-market/liquidation.");
    marks = [];
  }

  let funding: HistoricalFunding[] = [];
  try {
    const fundingRows = await fetchPagedRows<unknown>({
      endpoint: "https://fapi.binance.com/fapi/v1/fundingRate",
      params: { symbol },
      startTime,
      endTime,
      limit: 1_000,
      cursorStepMs: 1,
      maxRecords: maxCandles,
      maxRetries,
      timestamp: (row) => Number((row as Record<string, unknown>).fundingTime),
      key: (row) => {
        const item = row as Record<string, unknown>;
        return String(item.fundingTime) + ":" + String(item.fundingRate) + ":" + String(item.markPrice) + ":" + String(item.rateType);
      },
      fetchImpl,
      sleep,
      dataset: "funding history",
      onProgress,
    });
    funding = fundingRows.map(parseFundingRow).map(({ fundingTime, fundingRate, markPrice }) => ({
      fundingTime,
      fundingRate,
      markPrice,
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnings.push("Historical funding history unavailable: " + detail + ". Funding will not be included for this dataset.");
    funding = [];
  }

  return {
    candles,
    funding,
    marks,
    gapReport,
    warnings,
    startTime: candles[0].time,
    endTime: candles[candles.length - 1].time,
  };
}
