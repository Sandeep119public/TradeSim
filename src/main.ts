import "./style.css";
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import type { Side } from "./domain/paper-account";
import { ReplaySession, type HistoricalFunding, type OrderIntent } from "./domain/session-simulator";
import {
  HistoricalLoadCancelledError,
  HistoricalLoadTimeoutError,
  HistoricalRequestTimeoutError,
  loadBinanceHistoricalData,
  intervalToMs,
  MAX_REPLAY_CANDLES,
  type SupportedInterval,
} from "./domain/historical-data";
import type { MarkPriceCandle } from "./domain/mark-price";
import { validateCandles, type Candle } from "./domain/market";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root");

let session: ReplaySession;
let timer: ReturnType<typeof setTimeout> | null = null;
let speed = 1;
let symbol = "BTCUSDT";
let marketDataSymbol = "BTCUSDT";
let marketDataInterval = "1m";
let historicalLoadController: AbortController | null = null;
let isHistoricalLoading = false;
let historicalLoadGeneration = 0;
let side: Side = "LONG";
let orderType: "market" | "limit" = "market";
let limitPrice: number | null = null;
let candles: Candle[] = [];

const demoStart = Date.UTC(2026, 0, 15, 10, 0);
const demo: Candle[] = Array.from({ length: 120 }, (_, i) => {
  const open = 93_000 + Math.sin(i / 7) * 520 + i * 4;
  const close = open + Math.sin(i * 1.37) * 340;
  const wick = 90 + Math.abs(Math.cos(i)) * 120;
  return {
    time: demoStart + i * 60_000,
    open,
    high: Math.max(open, close) + wick,
    low: Math.min(open, close) - wick,
    close,
    volume: 15 + Math.abs(Math.sin(i / 3)) * 40,
  };
});

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="TradeSim home"><span class="brand-mark">T</span><span>TradeSim<small>FUTURES REPLAY LAB</small></span></a>
    <div class="top-actions"><span class="mode-pill"><span></span> PAPER MODE</span><button id="reset" class="ghost">Reset account</button></div>
  </header>
  <main class="layout">
    <section class="workspace">
      <div class="market-head">
        <div><span class="eyebrow">HISTORICAL MARKET</span><h1 id="symbol-title">BTCUSDT <span>PERPETUAL</span></h1><p id="timestamp">Load a dataset to begin replay</p></div>
        <div class="market-controls"><label>Market<select id="symbol"><option>BTCUSDT</option><option>SOLUSDT</option><option>ETHUSDT</option></select></label><label>Timeframe<select id="timeframe"><option value="1m">1 minute</option><option value="5m">5 minutes</option><option value="15m">15 minutes</option><option value="1h">1 hour</option></select></label></div>
      </div>
      <div class="data-range-controls">
        <label>Start (local time)<input id="range-start" type="datetime-local"/></label>
        <label>End (local time)<input id="range-end" type="datetime-local"/></label>
        <p>Leave both dates blank for the latest 1,000 closed candles. Historical ranges are paginated, with a ${MAX_REPLAY_CANDLES.toLocaleString("en-US")} candle safety limit.</p>
        <button id="cancel-load" class="ghost" type="button" hidden>Cancel load</button>
      </div>
      <div class="chart-card">
        <div class="chart-meta"><span>PRICE ACTION</span><span id="ohlc">Waiting for replay</span></div>
        <div id="chart" class="chart" role="region" aria-label="Paper replay candlestick chart"><div id="chart-empty" class="chart-empty" role="status" aria-live="polite"><div><span>READY TO REPLAY</span><strong>Price history appears as replay advances</strong><p>Press Play or +1 bar to begin. Future candles stay hidden until replay reaches them.</p></div></div></div>
        <div class="timeline"><div class="timeline-labels"><span id="start-time"></span><strong id="current-time"></strong><span id="end-time"></span></div><input id="seek" type="range" min="-1" max="119" value="-1" aria-label="Replay position"/></div>
        <div class="replay-controls"><button id="step-back" class="ghost">−1 bar</button><button id="play" class="primary">▶ Play</button><button id="step" class="ghost">+1 bar</button><label>Speed<select id="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option></select></label><button id="load-binance" class="ghost">Load Binance data</button><input id="csv" type="file" accept=".csv,.txt" aria-label="Import CSV candles" hidden/><button id="import-csv" class="ghost">Import CSV</button></div>
        <p id="notice" class="notice" role="status">Demo dataset loaded. Fetch Binance futures candles or import a CSV.</p>
      </div>
      <section class="section-card">
        <div class="section-title"><div><span class="eyebrow">ACCOUNT</span><h2>Paper account</h2></div><span class="paper-tag">NO REAL ORDERS</span></div><details class="assumptions"><summary>Execution assumptions and limitations</summary><p>After an order fills, the entire fill candle is checked for risk exits. For a limit fill this conservatively includes OHLC movement that may have happened before the fill. Attached stop-loss and take-profit triggers use trade-price candle OHLC. Liquidation uses mark-price OHLC when available, otherwise trade OHLC. If liquidation and another exit are both touched in one candle, liquidation wins because their order is unknown; if both SL and TP are touched, SL wins. Maintenance margin is a simplified fixed 0.5%, not Binance's symbol-specific brackets.</p></details>
        <div class="stats-grid"><div><span>Wallet balance</span><strong id="wallet">$10,000.00</strong></div><div><span>Equity</span><strong id="equity">$10,000.00</strong></div><div><span>Unrealized P&amp;L</span><strong id="unrealized">$0.00</strong></div><div><span>Realized P&amp;L</span><strong id="realized">$0.00</strong></div><div><span>Used margin</span><strong id="margin">$0.00</strong></div><div><span>Available margin</span><strong id="available">$10,000.00</strong></div><div><span>Net funding</span><strong id="funding">$0.00</strong></div></div>
      </section>
    </section>
    <aside class="trade-column">
      <section class="section-card order-card">
        <div class="section-title"><div><span class="eyebrow">ORDER ENTRY</span><h2>Paper trade</h2></div><span class="paper-tag">SIM</span></div>
        <div class="side-toggle" role="group" aria-label="Paper trade direction"><button id="long" class="side-button selected-long" type="button" aria-pressed="true">Long / Buy</button><button id="short" class="side-button" type="button" aria-pressed="false">Short / Sell</button></div>
        <label>Order type<select id="order-type"><option value="market">Market</option><option value="limit">Limit</option></select></label>
        <label>Quantity<input id="quantity" type="number" value="0.001" min="0.000001" step="any"/></label>
        <label>Leverage <strong id="lev-value">10×</strong><input id="leverage" type="range" min="1" max="50" value="10"/></label>
        <div class="preview"><div><span>Estimated notional</span><strong id="notional">$0.00</strong></div><div><span>Initial margin</span><strong id="initial-margin">$0.00</strong></div><div><span>Estimated entry fee</span><strong id="entry-fee">$0.00</strong></div></div>
        <div id="limit-wrap" hidden><label>Limit price<input id="limit-price" type="number" min="0" step="any"/></label></div>
        <div class="risk-grid"><label>Attached stop-loss<input id="sl-price" type="number" min="0" step="any" placeholder="Optional"/></label><label>Attached take-profit<input id="tp-price" type="number" min="0" step="any" placeholder="Optional"/></label></div>
        <button id="submit" class="submit-long" type="button" aria-describedby="order-hint" disabled>Open Long</button>
        <p id="order-hint" class="order-hint" hidden></p>
        <div class="position-box"><div class="section-title"><h3>Open position</h3><button id="close" class="ghost" disabled type="button">Close</button></div><div id="position-summary" class="empty">No open position</div></div>
        <div class="position-box"><div class="section-title"><h3>Order &amp; fill history</h3><button id="cancel-orders" class="ghost" type="button">Cancel pending</button></div><div id="activity-list" class="activity-list empty">No order activity yet</div></div>
      </section>
    </aside>
  </main>
`;

const el = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};
function setNotice(message: string, tone: "info" | "warning" | "error" = "info") {
  const notice = el<HTMLElement>("notice");
  notice.textContent = message;
  notice.dataset.tone = tone;
}
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (n: number | null) => n === null ? "Not started" : new Date(n).toLocaleString();
const chartHost = el<HTMLDivElement>("chart");
const chart: IChartApi = createChart(chartHost, {
  width: chartHost.clientWidth,
  height: chartHost.clientHeight,
  layout: { background: { color: "#0d1522" }, textColor: "#8290a6" },
  grid: { vertLines: { color: "#1c2939" }, horzLines: { color: "#1c2939" } },
  rightPriceScale: { borderColor: "#263449" },
  timeScale: { borderColor: "#263449", timeVisible: true, secondsVisible: false },
});
const series: ISeriesApi<"Candlestick"> = chart.addSeries(CandlestickSeries, {
  upColor: "#a5f04c", downColor: "#f15b70", borderUpColor: "#a5f04c",
  borderDownColor: "#f15b70", wickUpColor: "#a5f04c", wickDownColor: "#f15b70",
});
const resizeObserver = new ResizeObserver(() => chart.applyOptions({ width: chartHost.clientWidth, height: chartHost.clientHeight }));
resizeObserver.observe(chartHost);

function stopTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
function snapshot() { return session.snapshot(); }
function visibleCandles(): Candle[] {
  const state = snapshot();
  return state.index < 0 ? [] : candles.slice(0, state.index + 1);
}
function drawChart() {
  const shown = visibleCandles();
  series.setData(shown.map((c) => ({
    time: Math.floor(c.time / 1000) as Time,
    open: c.open, high: c.high, low: c.low, close: c.close,
  })));
  const state = snapshot();
  el<HTMLElement>("chart-empty").hidden = state.index >= 0;
  el<HTMLElement>("timestamp").textContent = state.timestamp === null ? "Replay has not started" : date(state.timestamp);
  el<HTMLElement>("current-time").textContent = state.timestamp === null ? "Not started" : date(state.timestamp);
  el<HTMLElement>("start-time").textContent = candles.length ? date(candles[0].time) : "";
  el<HTMLElement>("end-time").textContent = candles.length ? date(candles[candles.length - 1].time) : "";
  const slider = el<HTMLInputElement>("seek");
  slider.max = String(Math.max(0, candles.length - 1));
  slider.value = String(state.index);
  const current = state.candle;
  el<HTMLElement>("ohlc").textContent = current
    ? `O ${current.open.toFixed(2)}  H ${current.high.toFixed(2)}  L ${current.low.toFixed(2)}  C ${current.close.toFixed(2)}`
    : "Waiting for replay";
  el<HTMLButtonElement>("play").textContent = state.status === "playing" ? "Ⅱ Pause" : "▶ Play";
  el<HTMLButtonElement>("step").disabled = state.index >= candles.length - 1;
  el<HTMLButtonElement>("step-back").disabled = state.index <= -1;
  const acc = session.accountSnapshot();
  el<HTMLElement>("wallet").textContent = money(acc.walletBalance);
  el<HTMLElement>("equity").textContent = money(acc.equity);
  el<HTMLElement>("unrealized").textContent = money(acc.unrealizedPnl);
  el<HTMLElement>("realized").textContent = money(acc.realizedPnl);
  el<HTMLElement>("margin").textContent = money(acc.usedMargin);
  el<HTMLElement>("available").textContent = money(acc.availableMargin);
  el<HTMLElement>("funding").textContent = money(acc.netFunding);
  for (const id of ["unrealized", "realized"]) {
    const node = el<HTMLElement>(id);
    node.classList.toggle("positive", Number(node.textContent?.replace(/[^0-9.-]/g, "")) >= 0);
    node.classList.toggle("negative", Number(node.textContent?.replace(/[^0-9.-]/g, "")) < 0);
  }
  updatePreview();
  updateOrderAvailability();
  drawPosition();
  drawActivity();
}
function updatePreview() {
  const price = snapshot().candle?.close ?? snapshot().candle?.open ?? (candles[0]?.open ?? 0);
  const qty = Number(el<HTMLInputElement>("quantity").value);
  const leverage = Number(el<HTMLInputElement>("leverage").value);
  const notional = Number.isFinite(qty) && qty > 0 ? qty * price : 0;
  el<HTMLElement>("lev-value").textContent = `${leverage}×`;
  el<HTMLElement>("notional").textContent = money(notional);
  el<HTMLElement>("initial-margin").textContent = money(notional / leverage);
  el<HTMLElement>("entry-fee").textContent = money(notional * 0.0005);
}
function updateOrderAvailability() {
  const state = snapshot();
  const hasPendingOrder = session.ordersSnapshot().some((order) => order.status === "PENDING");
  const hasPosition = session.accountSnapshot().position !== null;
  const selectedDataMismatch = symbol !== marketDataSymbol || el<HTMLSelectElement>("timeframe").value !== marketDataInterval;
  const hint = isHistoricalLoading
    ? "Paper orders are paused while historical data loads."
    : !state.candle
    ? "Press Play or +1 bar to start replay before placing an order."
    : selectedDataMismatch
    ? "Load data for the selected market and timeframe before trading."
    : state.index >= candles.length - 1
    ? "Seek to an earlier candle to place a paper order."
    : hasPosition
    ? "Close the open position before placing another order."
    : hasPendingOrder
    ? "Cancel or wait for the pending order before placing another order."
    : "";
  const hintNode = el<HTMLElement>("order-hint");
  hintNode.textContent = hint;
  hintNode.hidden = hint.length === 0;
  el<HTMLButtonElement>("submit").disabled = hint.length > 0;
}
function drawPosition() {
  const position = session.accountSnapshot().position;
  const summary = el<HTMLElement>("position-summary");
  const closeButton = el<HTMLButtonElement>("close");
  closeButton.disabled = !position;
  if (!position) { summary.className = "empty"; summary.textContent = "No open position"; return; }
  const accountState = session.accountSnapshot();
  const mark = accountState.markPrice ?? snapshot().candle?.close ?? position.entryPrice;
  const pnl = accountState.unrealizedPnl;
  const sl = position.stopLossPrice === null ? "None" : money(position.stopLossPrice);
  const tp = position.takeProfitPrice === null ? "None" : money(position.takeProfitPrice);
  const liquidationPrice = session.accountSnapshot().liquidationPrice;
  const liq = liquidationPrice === null ? "Not estimated" : money(liquidationPrice);
  summary.className = "";
  summary.innerHTML = `<div><b>${position.symbol} · ${position.side}</b></div><div>Size: ${position.quantity} · Leverage: ${position.leverage}×</div><div>Entry: ${money(position.entryPrice)} · Mark: ${money(mark)}</div><div>SL: ${sl} · TP: ${tp}</div><div>Estimated liquidation: ${liq}</div><div class="${pnl >= 0 ? "positive" : "negative"}">Unrealized P&amp;L: ${money(pnl)}</div>`;
}
function drawActivity() {
  const list = el<HTMLDivElement>("activity-list");
  list.replaceChildren();
  const items = session.activitySnapshot();
  list.className = items.length ? "activity-list" : "activity-list empty";
  if (items.length === 0) {
    list.textContent = "No order activity yet";
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "activity-row";
    const timestamp = document.createElement("span");
    timestamp.className = "activity-time";
    timestamp.textContent = date(item.timestamp);
    const message = document.createElement("span");
    message.className = item.tone;
    message.textContent = item.message;
    row.append(timestamp, message);
    list.append(row);
  }
}
function advanceOneBar() {
  if (isHistoricalLoading) return snapshot();
  const previousActivity = session.activitySnapshot()[0];
  const state = session.step();
  const latestActivity = session.activitySnapshot()[0];
  if (latestActivity && (latestActivity.timestamp !== previousActivity?.timestamp || latestActivity.message !== previousActivity.message)) {
    if (latestActivity.message.startsWith("FUNDING SKIPPED")) {
      setNotice(latestActivity.message, "warning");
    } else if (/^(STOP LOSS|TAKE PROFIT|LIQUIDATION)/.test(latestActivity.message)) {
      setNotice("Paper " + latestActivity.message + " under the documented OHLC exit policy.", "warning");
    }
  }
  drawChart();
  return state;
}
function replayStep() {
  if (isHistoricalLoading) return;
  const state = advanceOneBar();
  if (state.status === "playing" && state.index < candles.length - 1) {
    timer = setTimeout(replayStep, Math.max(5, 1000 / speed));
  } else stopTimer();
}
function seekReplay(index: number) {
  if (isHistoricalLoading) return;
  stopTimer();
  session.seek(index);
  setNotice(index < 0
    ? "Replay returned to the start. Recorded actions will replay as you move forward."
    : "Paper state reconstructed through " + date(snapshot().timestamp) + ". A new action here will branch the timeline and replace later actions.");
  drawChart();
}
function setData(
  next: Candle[],
  message: string,
  funding: HistoricalFunding[] = [],
  marks: MarkPriceCandle[] = [],
  loadedSelection?: { symbol: string; interval: SupportedInterval },
) {
  stopTimer();
  const nextMarketSymbol = loadedSelection?.symbol ?? el<HTMLSelectElement>("symbol").value;
  const nextMarketInterval = loadedSelection?.interval ?? el<HTMLSelectElement>("timeframe").value;
  el<HTMLSelectElement>("symbol").value = nextMarketSymbol;
  el<HTMLSelectElement>("timeframe").value = nextMarketInterval;
  const candleIntervalMs = nextMarketInterval === "1m" ? 60_000 : nextMarketInterval === "5m" ? 300_000 : nextMarketInterval === "15m" ? 900_000 : 3_600_000;
  const nextSession = new ReplaySession(next, funding, marks, { candleIntervalMs });
  candles = next;
  marketDataSymbol = nextMarketSymbol;
  marketDataInterval = nextMarketInterval;
  session = nextSession;
  chart.timeScale().fitContent();
  setNotice(message + " Funding without an event mark uses an exact-time mark open or a completed prior mark close; if neither is available, the settlement is skipped and logged.");
  drawChart();
}
function parseCsv(text: string): Candle[] {
  const content = text.trim();
  if (!content) throw new Error("CSV is empty");
  const rows = content.split(/\r?\n/);
  const headerCells = rows[0].split(/[;,\t]/).map((part) => part.trim().replace(/^"|"$/g, "").toLowerCase());
  const hasHeader = ["time", "timestamp", "open_time", "datetime", "date"].includes(headerCells[0]) &&
    ["open", "high", "low", "close", "volume"].every((column) => headerCells.includes(column));
  const start = hasHeader ? 1 : 0;
  const parsed = rows.slice(start).map((line, index) => {
    const row = line.split(/[;,\t]/).map((part) => part.trim().replace(/^"|"$/g, ""));
    if (row.length < 6) throw new Error(`CSV row ${index + start + 1} needs time, open, high, low, close, volume`);
    let time = Number(row[0]);
    if (!Number.isFinite(time)) time = Date.parse(row[0]);
    if (time > 0 && time < 100_000_000_000) time *= 1000;
    return { time, open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
  });
  if (parsed.length === 0) throw new Error("CSV contains a header but no candle rows");
  try {
    validateCandles(parsed);
  } catch (error) {
    if (error instanceof Error) {
      const candleIndex = /^Candle (\d+) (.*)$/.exec(error.message);
      if (candleIndex) throw new Error(`CSV row ${Number(candleIndex[1]) + start + 1}: ${candleIndex[2]}`);
      const orderIndex = /index (\d+)\)$/.exec(error.message);
      if (orderIndex) throw new Error(`CSV row ${Number(orderIndex[1]) + start + 1}: ${error.message}`);
    }
    throw error;
  }
  return parsed;
}
async function fetchBinance() {
  if (isHistoricalLoading) return;
  const sessionBeforeLoad = session;
  const currentState = session.snapshot();
  const cancelButton = el<HTMLButtonElement>("cancel-load");
  const controlIds = [
    "load-binance", "symbol", "timeframe", "range-start", "range-end", "csv", "import-csv",
    "play", "step", "step-back", "seek", "reset", "submit", "close", "cancel-orders",
    "speed", "order-type", "quantity", "leverage", "limit-price", "sl-price", "tp-price", "long", "short",
  ];
  const controls = controlIds.map((id) => el<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(id));
  const wasDisabled = controls.map((control) => control.disabled);
  const wasPlaying = currentState.status === "playing";
  const loadController = new AbortController();
  const generation = ++historicalLoadGeneration;
  historicalLoadController = loadController;
  isHistoricalLoading = true;
  let loadSucceeded = false;
  stopTimer();
  session.pause();
  controls.forEach((control) => { control.disabled = true; });
  cancelButton.hidden = false;
  cancelButton.disabled = false;
  setNotice("Preparing historical Binance Futures data request…");
  try {
    const interval = el<HTMLSelectElement>("timeframe").value as SupportedInterval;
    const pair = el<HTMLSelectElement>("symbol").value;
    const intervalMs = intervalToMs(interval);
    const rawStart = el<HTMLInputElement>("range-start").value;
    const rawEnd = el<HTMLInputElement>("range-end").value;

    let startTime: number;
    let endTime: number;
    if (!rawStart && !rawEnd) {
      // Preserve the one-click default: load the latest 1,000 fully closed bars.
      endTime = Math.floor(Date.now() / intervalMs) * intervalMs - intervalMs;
      startTime = endTime - 999 * intervalMs;
    } else {
      if (!rawStart || !rawEnd) throw new Error("Choose both a start and end date/time, or leave both blank for the latest candles.");
      startTime = new Date(rawStart).getTime();
      endTime = new Date(rawEnd).getTime();
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime < startTime) {
        throw new Error("Start date/time must be before or equal to end date/time.");
      }
    }

    const data = await loadBinanceHistoricalData({
      symbol: pair,
      interval,
      startTime,
      endTime,
      maxCandles: MAX_REPLAY_CANDLES,
      signal: loadController.signal,
      onProgress: (progress) => {
        if (generation !== historicalLoadGeneration || loadController.signal.aborted) return;
        setNotice("Loading " + progress.dataset + " · page " + progress.page +
          " · " + progress.records.toLocaleString("en-US") + " record(s) collected…");
      },
    });

    const stateToReplace = session.snapshot();
    const hasStateToReplace = stateToReplace.index >= 0 ||
      session.hasRecordedUserActions() ||
      session.activitySnapshot().length > 0 ||
      session.accountSnapshot().position !== null ||
      session.ordersSnapshot().length > 0;
    if (hasStateToReplace && !window.confirm(
      "Loading a new dataset resets the current replay and paper-account history. Continue?",
    )) {
      setNotice("Historical data loaded, but replacement was declined. The existing dataset and paper state were preserved.", "warning");
      return;
    }

    const alignedMarks = new Set(data.marks.map((mark) => mark.time));
    const alignedCount = data.candles.filter((candle) => alignedMarks.has(candle.time)).length;
    const rangeSummary = " Range: " + date(data.candles[0].time) + " to " + date(data.candles[data.candles.length - 1].time) + ".";
    const fundingSummary = " " + data.funding.length.toLocaleString("en-US") + " historical funding event(s) loaded.";
    const markSummary = " " + alignedCount.toLocaleString("en-US") + "/" +
      data.candles.length.toLocaleString("en-US") + " candle-aligned mark-price candles loaded.";
    const warningSummary = data.warnings.length ? " Warnings: " + data.warnings.join(" ") : " No candle timestamp gaps detected.";
    symbol = pair;
    setData(
      data.candles,
      "Loaded " + data.candles.length.toLocaleString("en-US") + " public Binance Futures " + symbol +
        " candles." + rangeSummary + fundingSummary + markSummary + warningSummary + " Replay is paused at the beginning.",
      data.funding,
      data.marks,
      { symbol: pair, interval },
    );
    loadSucceeded = true;
  } catch (error) {
    if (generation !== historicalLoadGeneration) return;
    if (loadController.signal.aborted || error instanceof HistoricalLoadCancelledError) {
      setNotice("Historical data load cancelled. The existing dataset and paper state were preserved.", "warning");
    } else {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(error instanceof HistoricalRequestTimeoutError
        ? "Binance request timed out: " + message + ". The existing dataset and paper state were preserved."
        : error instanceof HistoricalLoadTimeoutError
        ? message + ". The existing dataset and paper state were preserved."
        : "Unable to load Binance data: " + message + ". The existing dataset and paper state were preserved.", "error");
    }
  } finally {
    if (generation === historicalLoadGeneration) {
      historicalLoadController = null;
      isHistoricalLoading = false;
      cancelButton.hidden = true;
      controls.forEach((control, index) => { control.disabled = wasDisabled[index]; });
      if (loadSucceeded) drawChart();
      if (wasPlaying && session === sessionBeforeLoad) {
        session.play();
        replayStep();
      }
    }
  }
}
el<HTMLButtonElement>("play").addEventListener("click", () => {
  if (isHistoricalLoading) return;
  if (snapshot().status === "playing") {
    stopTimer();
    session.pause();
    drawChart();
    return;
  }
  if (snapshot().status === "ended") seekReplay(-1);
  session.play();
  replayStep();
});
el<HTMLButtonElement>("step").addEventListener("click", () => {
  if (isHistoricalLoading) return;
  stopTimer();
  session.pause();
  advanceOneBar();
});
el<HTMLButtonElement>("step-back").addEventListener("click", () => seekReplay(Math.max(-1, snapshot().index - 1)));
el<HTMLInputElement>("seek").addEventListener("input", (event) => seekReplay(Number((event.target as HTMLInputElement).value)));
el<HTMLSelectElement>("speed").addEventListener("change", (event) => {
  if (isHistoricalLoading) return;
  speed = Number((event.target as HTMLSelectElement).value);
  session.setSpeed(speed);
});
el<HTMLSelectElement>("symbol").addEventListener("change", (event) => {
  if (isHistoricalLoading) return;
  const select = event.target as HTMLSelectElement;
  const pair = select.value;
  if (session.accountSnapshot().position || session.ordersSnapshot().some((order) => order.status === "PENDING")) {
    select.value = symbol;
    setNotice("Close the position and cancel pending orders before switching symbols.", "warning");
    return;
  }
  symbol = pair;
  el<HTMLElement>("symbol-title").textContent = `${symbol} PERPETUAL`;
  setNotice("Symbol selected. Fetch Binance candles to load its historical data.");
  updateOrderAvailability();
});
el<HTMLSelectElement>("order-type").addEventListener("change", (event) => {
  if (isHistoricalLoading) return;
  orderType = (event.target as HTMLSelectElement).value as "market" | "limit";
  el<HTMLElement>("limit-wrap").hidden = orderType !== "limit";
  updatePreview();
});
el<HTMLInputElement>("limit-price").addEventListener("input", (event) => {
  if (isHistoricalLoading) return;
  const value = Number((event.target as HTMLInputElement).value);
  limitPrice = Number.isFinite(value) && value > 0 ? value : null;
});
el<HTMLInputElement>("quantity").addEventListener("input", () => { if (!isHistoricalLoading) updatePreview(); });
el<HTMLInputElement>("leverage").addEventListener("input", () => { if (!isHistoricalLoading) updatePreview(); });
el<HTMLButtonElement>("long").addEventListener("click", () => { if (isHistoricalLoading) return; side = "LONG"; updateSideUi(); });
el<HTMLButtonElement>("short").addEventListener("click", () => { if (isHistoricalLoading) return; side = "SHORT"; updateSideUi(); });
function updateSideUi() {
  el<HTMLButtonElement>("long").className = `side-button ${side === "LONG" ? "selected-long" : ""}`;
  el<HTMLButtonElement>("short").className = `side-button ${side === "SHORT" ? "selected-short" : ""}`;
  const button = el<HTMLButtonElement>("submit");
  button.textContent = side === "LONG" ? "Open Long" : "Open Short";
  button.className = side === "LONG" ? "submit-long" : "submit-short";
  el<HTMLButtonElement>("long").setAttribute("aria-pressed", String(side === "LONG"));
  el<HTMLButtonElement>("short").setAttribute("aria-pressed", String(side === "SHORT"));
  updateOrderAvailability();
}
el<HTMLButtonElement>("submit").addEventListener("click", () => {
  if (isHistoricalLoading) return;
  try {
    const state = snapshot();
    if (!state.candle) throw new Error("Start replay before placing an order");
    if (symbol !== marketDataSymbol || el<HTMLSelectElement>("timeframe").value !== marketDataInterval) {
      throw new Error("Fetch or import candles for the selected symbol and timeframe before trading.");
    }
    if (state.index >= candles.length - 1) throw new Error("Replay is at the last candle. Seek to an earlier candle to trade.");
    if (session.accountSnapshot().position) throw new Error("Close the open position before placing another order");
    if (session.ordersSnapshot().some((order) => order.status === "PENDING")) throw new Error("Cancel or wait for the pending order first");

    const quantity = Number(el<HTMLInputElement>("quantity").value);
    const leverage = Number(el<HTMLInputElement>("leverage").value);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a valid quantity");
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > 50) throw new Error("Leverage must be between 1x and 50x");
    if (orderType === "limit" && (limitPrice === null || !Number.isFinite(limitPrice) || limitPrice <= 0)) {
      throw new Error("Enter a valid limit price");
    }
    const rawSl = el<HTMLInputElement>("sl-price").value.trim();
    const rawTp = el<HTMLInputElement>("tp-price").value.trim();
    const stopLossPrice = rawSl === "" ? null : Number(rawSl);
    const takeProfitPrice = rawTp === "" ? null : Number(rawTp);
    if (stopLossPrice !== null && (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0)) throw new Error("Stop-loss must be a positive price");
    if (takeProfitPrice !== null && (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0)) throw new Error("Take-profit must be a positive price");
    const reference = orderType === "limit" && limitPrice !== null ? limitPrice : state.candle.close;
    if (stopLossPrice !== null && (side === "LONG" ? stopLossPrice >= reference : stopLossPrice <= reference)) {
      throw new Error("Stop-loss must be below entry for Long and above entry for Short");
    }
    if (takeProfitPrice !== null && (side === "LONG" ? takeProfitPrice <= reference : takeProfitPrice >= reference)) {
      throw new Error("Take-profit must be above entry for Long and below entry for Short");
    }

    const order: OrderIntent = {
      symbol,
      side,
      type: orderType,
      quantity,
      leverage,
      limitPrice: orderType === "limit" ? limitPrice : null,
      stopLossPrice,
      takeProfitPrice,
    };
    session.submitOrder(order);
    setNotice(order.type === "market"
      ? "Paper market order queued. It will fill at the next eligible candle open."
      : "Paper limit order queued. It can fill only on a future candle that reaches the limit; OHLC fills are approximate.");
    drawChart();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), "error");
  }
});
el<HTMLButtonElement>("close").addEventListener("click", () => {
  if (isHistoricalLoading) return;
  try {
    if (!snapshot().candle) throw new Error("No replay price available");
    if (!session.accountSnapshot().position) throw new Error("No open position");
    session.closePosition();
    const price = candles[snapshot().index].close;
    setNotice("Paper position closed at " + money(price) + ".");
    drawChart();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), "error");
  }
});
el<HTMLButtonElement>("reset").addEventListener("click", () => {
  if (isHistoricalLoading) return;
  session.resetAccount();
  drawChart();
  setNotice("Paper account and order history reset at the current replay position.");
});
el<HTMLButtonElement>("cancel-orders").addEventListener("click", () => {
  if (isHistoricalLoading) return;
  const pending = session.ordersSnapshot().filter((order) => order.status === "PENDING");
  if (pending.length === 0) {
    setNotice("No pending orders to cancel.", "warning");
    return;
  }
  session.cancelPendingOrders();
  setNotice("Cancelled pending order(s).");
  drawChart();
});
el<HTMLButtonElement>("load-binance").addEventListener("click", () => void fetchBinance());
el<HTMLButtonElement>("cancel-load").addEventListener("click", () => {
  if (!isHistoricalLoading) return;
  historicalLoadController?.abort(new HistoricalLoadCancelledError());
});
el<HTMLButtonElement>("import-csv").addEventListener("click", () => {
  if (!isHistoricalLoading) el<HTMLInputElement>("csv").click();
});
el<HTMLInputElement>("csv").addEventListener("change", async (event) => {
  if (isHistoricalLoading) return;
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    setData(parseCsv(await file.text()), `Imported ${file.name}. Replay is paused at the beginning.`);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), "error");
  }
});
window.addEventListener("beforeunload", () => {
  stopTimer();
  historicalLoadController?.abort(new HistoricalLoadCancelledError("Page closed during historical data load"));
  resizeObserver.disconnect();
  chart.remove();
});

setData(demo, "Demo data loaded. Fetch historical Binance futures candles or import a CSV.");
el<HTMLSelectElement>("timeframe").addEventListener("change", () => {
  if (isHistoricalLoading) return;
  setNotice("Change timeframe, then fetch Binance candles to load that interval.");
  updateOrderAvailability();
});
