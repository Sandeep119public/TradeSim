import { expect, test } from "@playwright/test";

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
};

test("loads the latest 1,000 closed candles from public Binance Futures", async ({ page }) => {
  const symbol = process.env.TRADESIM_SMOKE_SYMBOL ?? "BTCUSDT";
  const interval = process.env.TRADESIM_SMOKE_INTERVAL ?? "1m";
  const intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) throw new Error("Unsupported smoke-test interval: " + interval);

  await page.goto("/");
  await page.locator("#symbol").selectOption(symbol);
  await page.locator("#timeframe").selectOption(interval);
  await expect(page.locator("#range-start")).toHaveValue("");
  await expect(page.locator("#range-end")).toHaveValue("");

  await page.locator("#load-binance").click();

  const notice = page.locator("#notice");
  await expect(notice).toContainText(
    "Loaded 1,000 public Binance Futures " + symbol + " candles.",
  );

  await expect(notice).toContainText(/Range: .+ to .+\./);
  await expect(notice).toContainText(/\d+ historical funding event\(s\) loaded\./);
  await expect(notice).toContainText(/\d+\/1,000 candle-aligned mark-price candles loaded\./);
  await expect(page.locator("#symbol")).toHaveValue(symbol);
  await expect(page.locator("#timeframe")).toHaveValue(interval);
  await expect(page.locator("#symbol")).toBeEnabled();
  await expect(page.locator("#timeframe")).toBeEnabled();
  await expect(page.locator("#range-start")).toBeEnabled();
  await expect(page.locator("#range-end")).toBeEnabled();

  const candleTimes = await page.evaluate(() => ({
    endTime: Date.parse(document.querySelector("#end-time")?.textContent ?? ""),
    now: Date.now(),
  }));
  expect(Number.isFinite(candleTimes.endTime)).toBe(true);
  const latestFullyClosedCandleOpen = Math.floor(candleTimes.now / intervalMs) * intervalMs - intervalMs;
  expect(candleTimes.endTime).toBeLessThanOrEqual(latestFullyClosedCandleOpen);

  await page.locator("#step").click();
  await expect(page.locator("#ohlc")).toHaveText(/^O [\d.]+  H [\d.]+  L [\d.]+  C [\d.]+$/);
});
