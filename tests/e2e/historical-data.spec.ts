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
  pauseFirstTradePage?: boolean;
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

    if (options.pauseFirstTradePage && url.pathname === "/fapi/v1/klines" && requests.get(url.pathname) === 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    } else if (
      options.pauseSecondTradePage && url.pathname === "/fapi/v1/klines" && startTime > options.candleTimes[0]
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
  await expect(page.locator("#csv")).toBeDisabled();
  await expect(page.locator("#import-csv")).toBeDisabled();

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
  await expect(page.locator("#csv")).toBeEnabled();
  await expect(page.locator("#import-csv")).toBeEnabled();

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

test("freezes replay and paper actions during a delayed load, then starts the new dataset cleanly", async ({ page }) => {
  const startDate = new Date(Date.UTC(2025, 0, 3, 0, 0));
  const candleTimes = Array.from({ length: 3 }, (_, index) => startDate.getTime() + index * INTERVAL_MS);
  await mockBinance(page, { candleTimes, pauseFirstTradePage: true });

  await page.goto("/");
  await page.locator("#step").click();
  await page.locator("#submit").click();
  await page.locator("#step").click();
  await expect(page.locator("#position-summary")).toContainText("BTCUSDT · LONG");
  await page.locator("#play").click();

  await page.locator("#range-start").fill(inputDate(startDate));
  await page.locator("#range-end").fill(inputDate(new Date(candleTimes[2])));
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#load-binance").click();
  await expect(page.locator("#cancel-load")).toBeVisible();

  const lockedIds = [
    "load-binance", "symbol", "timeframe", "range-start", "range-end", "csv", "import-csv",
    "play", "step", "step-back", "seek", "reset", "submit", "close", "cancel-orders",
    "speed", "order-type", "quantity", "leverage", "limit-price", "sl-price", "tp-price", "long", "short",
  ];
  for (const id of lockedIds) await expect(page.locator("#" + id)).toBeDisabled();

  const before = await page.locator("#current-time").textContent();
  const oldPosition = await page.locator("#position-summary").textContent();
  const oldActivity = await page.locator("#activity-list").textContent();
  const oldWallet = await page.locator("#wallet").textContent();
  await page.evaluate(() => {
    for (const id of ["play", "step", "step-back", "reset", "submit", "close", "cancel-orders"]) {
      document.querySelector<HTMLButtonElement>("#" + id)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const seek = document.querySelector<HTMLInputElement>("#seek");
    if (seek) {
      seek.value = "0";
      seek.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.waitForTimeout(150);
  await expect(page.locator("#current-time")).toHaveText(before ?? "");
  await expect(page.locator("#position-summary")).toHaveText(oldPosition ?? "");
  await expect(page.locator("#activity-list")).toHaveText(oldActivity ?? "");
  await expect(page.locator("#wallet")).toHaveText(oldWallet ?? "");

  await expect(page.locator("#notice")).toContainText("Loaded 3 public Binance Futures BTCUSDT candles.");
  await expect(page.locator("#current-time")).toHaveText("Not started");
  await expect(page.locator("#position-summary")).toHaveText("No open position");
  await expect(page.locator("#activity-list")).toHaveText("No order activity yet");
  await expect(page.locator("#wallet")).toHaveText("$10,000.00");
  for (const id of lockedIds) {
    if (id === "close") continue;
    await expect(page.locator("#" + id)).toBeEnabled();
  }
  await expect(page.locator("#close")).toBeDisabled();
  await expect(page.locator("#cancel-load")).toBeHidden();
});

test("restores loading controls after a required candle request fails", async ({ page }) => {
  await page.route("https://fapi.binance.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/fapi/v1/klines") {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ msg: "bad range" }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
  });
  await page.goto("/");
  await page.locator("#load-binance").click();

  await expect(page.locator("#notice")).toContainText("Unable to load Binance data: Binance returned HTTP 400");
  for (const id of ["load-binance", "symbol", "timeframe", "range-start", "range-end", "csv", "import-csv", "play", "step", "step-back", "seek", "reset", "submit", "cancel-orders"]) {
    await expect(page.locator("#" + id)).toBeEnabled();
  }
  await expect(page.locator("#close")).toBeDisabled();
  await expect(page.locator("#cancel-load")).toBeHidden();
  await expect(page.locator("#current-time")).toHaveText("Not started");
});

test("supports cancellation and keeps a later load from being replaced by the cancelled request", async ({ page }) => {
  const oldStart = new Date(Date.UTC(2025, 1, 1, 0, 0));
  const newStart = new Date(Date.UTC(2025, 2, 1, 0, 0));
  const oldTime = oldStart.getTime();
  const newTimes = Array.from({ length: 2 }, (_, index) => newStart.getTime() + index * INTERVAL_MS);
  let releaseOldResponse: (() => void) | undefined;
  const oldResponse = new Promise<void>((resolve) => { releaseOldResponse = resolve; });
  await page.route("https://fapi.binance.com/**", async (route) => {
    const url = new URL(route.request().url());
    const startTime = Number(url.searchParams.get("startTime"));
    if (url.pathname === "/fapi/v1/klines" && startTime <= oldTime && Number(url.searchParams.get("endTime")) >= oldTime) {
      await oldResponse;
      try {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([klineRow(oldTime)]) });
      } catch {
        // The browser request should have been aborted by the explicit cancel action.
      }
      return;
    }
    if (url.pathname === "/fapi/v1/klines" || url.pathname === "/fapi/v1/markPriceKlines") {
      const rows = newTimes.filter((time) => time >= startTime && time <= Number(url.searchParams.get("endTime"))).map(klineRow);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/");
  await page.locator("#step").click();
  await page.locator("#submit").click();
  const oldCurrentTime = await page.locator("#current-time").textContent();
  const oldActivity = await page.locator("#activity-list").textContent();
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#range-start").fill(inputDate(oldStart));
  await page.locator("#range-end").fill(inputDate(oldStart));
  await page.locator("#load-binance").click();
  await expect(page.locator("#cancel-load")).toBeVisible();
  await page.locator("#cancel-load").click();
  await expect(page.locator("#notice")).toContainText("load cancelled");
  await expect(page.locator("#notice")).not.toContainText("network request failed");
  await expect(page.locator("#load-binance")).toBeEnabled();
  await expect(page.locator("#current-time")).toHaveText(oldCurrentTime ?? "");
  await expect(page.locator("#activity-list")).toHaveText(oldActivity ?? "");
  await expect(page.locator("#activity-list")).not.toHaveText("No order activity yet");

  await page.locator("#range-start").fill(inputDate(newStart));
  await page.locator("#range-end").fill(inputDate(new Date(newTimes[1])));
  await page.locator("#load-binance").click();
  await expect(page.locator("#notice")).toContainText("Loaded 2 public Binance Futures BTCUSDT candles.");

  releaseOldResponse?.();
  await page.waitForTimeout(50);
  await expect(page.locator("#notice")).toContainText("Loaded 2 public Binance Futures BTCUSDT candles.");
  await expect(page.locator("#current-time")).toHaveText("Not started");
});

test("times out a stalled request and restores the interface", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await page.route("https://fapi.binance.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/fapi/v1/klines") return new Promise<void>(() => undefined);
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto("/");
  await page.locator("#load-binance").click();
  await expect(page.locator("#cancel-load")).toBeVisible();
  await page.clock.runFor(90_000);

  await expect(page.locator("#notice")).toContainText("timed out");
  await expect(page.locator("#load-binance")).toBeEnabled();
  await expect(page.locator("#symbol")).toBeEnabled();
  await expect(page.locator("#play")).toBeEnabled();
  await expect(page.locator("#submit")).toBeEnabled();
  await expect(page.locator("#cancel-load")).toBeHidden();
  await expect(page.locator("#current-time")).toHaveText("Not started");
});
