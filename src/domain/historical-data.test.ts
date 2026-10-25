import { describe, expect, it, vi } from "vitest";
import {
  fetchPagedRows,
  inspectCandleGaps,
  loadBinanceHistoricalData,
  type HistoricalFetch,
} from "./historical-data";

function jsonResponse(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

describe("fetchPagedRows", () => {
  it("paginates inclusive timestamp ranges without duplicates or skipped rows", async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({ time: (index + 1) * 1_000, value: index }));
    const calls: URL[] = [];
    const fetchImpl: HistoricalFetch = async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      const start = Number(url.searchParams.get("startTime"));
      const end = Number(url.searchParams.get("endTime"));
      const limit = Number(url.searchParams.get("limit"));
      return jsonResponse(rows.filter((row) => row.time >= start && row.time <= end).slice(0, limit));
    };

    const result = await fetchPagedRows({
      endpoint: "https://example.test/klines",
      params: { symbol: "BTCUSDT" },
      startTime: 1_000,
      endTime: 5_000,
      limit: 2,
      cursorStepMs: 1_000,
      timestamp: (row: { time: number }) => row.time,
      fetchImpl,
      sleep: async () => undefined,
      dataset: "trade candles",
    });

    expect(result.map((row) => row.time)).toEqual([1_000, 2_000, 3_000, 4_000, 5_000]);
    expect(calls).toHaveLength(3);
    expect(calls[0].searchParams.get("startTime")).toBe("1000");
    expect(calls[1].searchParams.get("startTime")).toBe("3000");
    expect(calls[2].searchParams.get("startTime")).toBe("5000");
  });

  it("retries rate-limit responses and honors Retry-After", async () => {
    let calls = 0;
    const waits: number[] = [];
    const result = await fetchPagedRows({
      endpoint: "https://example.test/klines",
      params: {},
      startTime: 1_000,
      endTime: 1_000,
      limit: 10,
      cursorStepMs: 1,
      timestamp: (row: { time: number }) => row.time,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ code: -1003 }, 429, { "Retry-After": "0" })
          : jsonResponse([{ time: 1_000 }]);
      },
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      dataset: "trade candles",
    });

    expect(calls).toBe(2);
    expect(waits).toEqual([0]);
    expect(result).toEqual([{ time: 1_000 }]);
  });

  it("fails immediately for non-retryable client errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "bad request" }, 400));
    await expect(fetchPagedRows({
      endpoint: "https://example.test/klines",
      params: {},
      startTime: 1_000,
      endTime: 1_000,
      limit: 10,
      cursorStepMs: 1,
      timestamp: (row: { time: number }) => row.time,
      fetchImpl,
      sleep: async () => undefined,
      dataset: "trade candles",
    })).rejects.toThrow("HTTP 400");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails rather than looping if a full page cannot advance its cursor", async () => {
    await expect(fetchPagedRows({
      endpoint: "https://example.test/klines",
      params: {},
      startTime: 10_000,
      endTime: 20_000,
      limit: 2,
      cursorStepMs: 1,
      timestamp: (row: { time: number }) => row.time,
      fetchImpl: async () => jsonResponse([{ time: 1 }, { time: 2 }]),
      sleep: async () => undefined,
      dataset: "trade candles",
    })).rejects.toThrow("pagination made no progress");
  });
});

describe("historical candle gap diagnostics", () => {
  it("reports gaps without inventing replacement candles", () => {
    expect(inspectCandleGaps([{ time: 0 }, { time: 60_000 }, { time: 180_000 }], 60_000)).toEqual({
      gapTransitions: 1,
      estimatedMissingCandles: 1,
    });
  });

  it("rejects unordered timestamps and invalid intervals", () => {
    expect(() => inspectCandleGaps([{ time: 60_000 }, { time: 0 }], 60_000)).toThrow("strictly increasing");
    expect(() => inspectCandleGaps([], 0)).toThrow(RangeError);
  });
});

describe("loadBinanceHistoricalData", () => {
  it("loads closed trade and mark candles plus funding for the selected time range", async () => {
    const base = 1_700_000_000_000;
    const tradeRows = [
      [base, "100", "105", "95", "102", "10"],
      [base + 60_000, "102", "108", "101", "107", "12"],
    ];
    const markRows = [
      [base, "100", "104", "96", "101"],
      [base + 60_000, "101", "107", "100", "106"],
    ];
    const fundingRows = [
      { fundingTime: base + 30_000, fundingRate: "0.001", markPrice: "101.5", rateType: "Regular" },
    ];
    const urls: string[] = [];
    const fetchImpl: HistoricalFetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url.pathname);
      if (url.pathname.endsWith("/klines")) return jsonResponse(tradeRows);
      if (url.pathname.endsWith("/markPriceKlines")) return jsonResponse(markRows);
      if (url.pathname.endsWith("/fundingRate")) return jsonResponse(fundingRows);
      return jsonResponse({}, 404);
    };

    const result = await loadBinanceHistoricalData({
      symbol: "BTCUSDT",
      interval: "1m",
      startTime: base,
      endTime: base + 60_000,
      nowMs: base + 180_000,
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(result.candles).toHaveLength(2);
    expect(result.marks).toHaveLength(2);
    expect(result.funding).toEqual([{
      fundingTime: base + 30_000,
      fundingRate: 0.001,
      markPrice: 101.5,
    }]);
    expect(result.warnings).toEqual([]);
    expect(urls).toEqual([
      "/fapi/v1/klines",
      "/fapi/v1/markPriceKlines",
      "/fapi/v1/fundingRate",
    ]);
  });

  it("reports optional mark-price and funding failures while retaining trade candles", async () => {
    const base = 1_700_000_000_000;
    const fetchImpl: HistoricalFetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/klines")) {
        return jsonResponse([[base, "100", "105", "95", "102", "10"]]);
      }
      return jsonResponse({ message: "unavailable" }, 503);
    };

    const result = await loadBinanceHistoricalData({
      symbol: "BTCUSDT",
      interval: "1m",
      startTime: base,
      endTime: base,
      nowMs: base + 60_000,
      maxRetries: 0,
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(result.candles).toHaveLength(1);
    expect(result.marks).toEqual([]);
    expect(result.funding).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("Historical mark-price candles unavailable");
    expect(result.warnings.join(" ")).toContain("Historical funding history unavailable");
  });

  it("filters the unfinished last candle and reports timestamp gaps", async () => {
    const base = 1_700_000_000_000;
    const fetchImpl: HistoricalFetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/klines")) {
        return jsonResponse([
          [base, "100", "105", "95", "102", "10"],
          [base + 120_000, "102", "108", "101", "107", "12"],
          [base + 180_000, "107", "110", "106", "109", "13"],
        ]);
      }
      if (url.pathname.endsWith("/markPriceKlines")) return jsonResponse([]);
      return jsonResponse([]);
    };

    const result = await loadBinanceHistoricalData({
      symbol: "BTCUSDT",
      interval: "1m",
      startTime: base,
      endTime: base + 180_000,
      nowMs: base + 240_000,
      maxRetries: 0,
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(result.candles.map((candle) => candle.time)).toEqual([base, base + 120_000, base + 180_000]);
    expect(result.gapReport).toEqual({ gapTransitions: 1, estimatedMissingCandles: 1 });
    expect(result.warnings[0]).toContain("timestamp spacing issue");
  });

  it("rejects a range with exactly one candle beyond the replay safety limit before fetching", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    await expect(loadBinanceHistoricalData({
      symbol: "BTCUSDT",
      interval: "1m",
      startTime: 0,
      endTime: 100_000 * 60_000,
      fetchImpl,
      sleep: async () => undefined,
    })).rejects.toThrow("safety limit");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a full-size range when the entered timestamps are off candle boundaries", async () => {
    const interval = 60_000;
    const startTime = interval - 1;
    const endTime = 100_001 * interval - 1;
    const resultRows = [
      [interval, "100", "105", "95", "102", "10"],
      [2 * interval, "102", "108", "101", "107", "12"],
    ];
    const fetchImpl: HistoricalFetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/klines")) return jsonResponse(resultRows);
      return jsonResponse([]);
    };

    const result = await loadBinanceHistoricalData({
      symbol: "BTCUSDT",
      interval: "1m",
      startTime,
      endTime,
      nowMs: endTime + interval,
      maxCandles: 100_000,
      maxRetries: 0,
      fetchImpl,
      sleep: async () => undefined,
    });
    expect(result.candles.map((item) => item.time)).toEqual([interval, 2 * interval]);
  });
});
