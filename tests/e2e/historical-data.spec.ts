import { expect, test, type Page } from "@playwright/test";

const INTERVAL_MS = 60_000;

function inputDate(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function klineRow(time: number): Array<string | number> {
  const open = 100 + ((time / INTERVAL_MS) % 100) * 0.01;
  const close = open + 0.25;
  return [
    time,
    open.toFixed(2),
    (close + 1).toFixed(2),
    (open - 1).toFixed(2),
    close.toFixed(2),
    "10",
    time + INTERVAL_MS - 1,
    "1000",
    5,
    "4",
    "400",
    "0",
  ];
}

interface BinanceMockOptions {
  candleTimes: number[];
  pauseSecondTradePage?: boolean;
  optionalEndpointStatus?: number;
}

async function mockBinance(page: Page, options: BinanceMockOptions): Promise<Map<string, number>> {
  const requests = new Map<string, number>();

  await page.route("https://fapi.binance.com/**", async (route) => {
    const url = new URL(route.request().url());
    requests.set(url.pathname, (requests.get(url.pathname) ?? 0) + 1);

    if (url.pathname === "/fapi/v1/fundingRate") {
      if (options.optionalEndpointStatus) {
        await route.fulfill({
          status: options.optionalEndpointStatus,
          contentType: "application/json",
          body: JSON.stringify({ code: -1, msg: "Mock funding endpoint failure" }),
        });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
      return;
    }

    if (url.pathname === "/fapi/v1/markPriceKlines" && options.optionalEndpointStatus) {
      await route.fulfill({
        status: options.optionalEndpointStatus,
        contentType: "application/json",
        body: JSON.stringify({ code: -1, msg: "Mock mark-price endpoint failure" }),
      });
      return;
    }

    if (url.pathname !== "/fapi/v1/klines" && url.pathname !== "/fapi/v1/markPriceKlines") {
      await route.fulfill({ status: 404, body: "Unexpected mocked Binance endpoint" });
      return;
    }

    const startTime = Number(url.searchParams.get("startTime"));
    const endTime = Number(url.searchParams.get("endTime"));
    const limit = Number(url.searchParams.get("limit") ?? "1000");

    if (
      options.pauseSecondTradePage &&
      url.pathname === "/fapi/v1/klines" &&
      startTime > options.candleTimes[0]
    ) {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }

    const rows = options.candleTimes
      .filter((time) => time >= startTime && time <= endTime)
      .slice(0, limit)
      .map(klineRow);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows),
    });
  });

  return requests;
}

test("paginates a 1,001-candle range and locks selection controls while fetching", async ({ page }) => {
  const startDate = new Date(Date.UTC(2025, 0, 1, 0, 0));
  const candleTimes = Array.from(
    { length: 1_001 },
    (_, index) => startDate.getTime() + index * INTERVAL_MS,
  );
  const endDate = new Date(candleTimes[candleTimes.length - 1]);
  const requests = await mockBinance(page, {
    candleTimes,
    pauseSecondTradePage: true,
  });

  await page.goto("/");
  await page.locator("#symbol").selectOption("ETHUSDT");
  await page.locator("#timeframe").selectOption("1m");
  await page.locator("#range-start").fill(inputDate(startDate));
  await page.locator("#range-end").fill(inputDate(endDate));
  await page.locator("#load-binance").click();

  await expect(page.locator("#notice")).toContainText(
    "page 1 · 1,000 record(s) collected",
  );
  await expect(page.locator("#symbol")).toBeDisabled();
  await expect(page.locator("#timeframe")).toBeDisabled();
  await expect(page.locator("#range-start")).toBeDisabled();
  await expect(page.locator("#range-end")).toBeDisabled();

  await expect(page.locator("#notice")).toContainText(
    "Loaded 1,001 public Binance Futures ETHUSDT candles.",
    { timeout: 10_000 },
  );
  await expect(page.locator("#notice")).toContainText("1,001/1,001 candle-aligned mark-price candles loaded.");
  await expect(page.locator("#symbol")).toHaveValue("ETHUSDT");
  await expect(page.locator("#timeframe")).toHaveValue("1m");
  await expect(page.locator("#symbol")).toBeEnabled();
  await expect(page.locator("#timeframe")).toBeEnabled();
  await expect(page.locator("#range-start")).toBeEnabled();
  await expect(page.locator("#range-end")).toBeEnabled();

  expect(requests.get("/fapi/v1/klines")).toBe(2);
  expect(requests.get("/fapi/v1/markPriceKlines")).toBe(2);
  expect(requests.get("/fapi/v1/fundingRate")).toBe(1);
});

test("keeps trade candles usable and reports gaps when optional endpoints fail", async ({ page }) => {
  const startDate = new Date(Date.UTC(2025, 0, 2, 0, 0));
  const candleTimes = [
    startDate.getTime(),
    startDate.getTime() + 2 * INTERVAL_MS,
    startDate.getTime() + 3 * INTERVAL_MS,
  ];
  await mockBinance(page, {
    candleTimes,
    optionalEndpointStatus: 400,
  });

  await page.goto("/");
  await page.locator("#range-start").fill(inputDate(startDate));
  await page.locator("#range-end").fill(inputDate(new Date(candleTimes[2])));
  await page.locator("#load-binance").click();

  const notice = page.locator("#notice");
  await expect(notice).toContainText("Loaded 3 public Binance Futures BTCUSDT candles.");
  await expect(notice).toContainText("Warnings:");
  await expect(notice).toContainText("1 candle timestamp spacing issue(s) detected; approximately 1 candle slot(s) appear to be missing.");
  await expect(notice).toContainText("Historical mark-price candles unavailable");
  await expect(notice).toContainText("Historical funding history unavailable");
  await expect(page.locator("#symbol")).toBeEnabled();
});
