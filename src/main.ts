import "./style.css";
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { PaperAccount, type Side } from "./domain/paper-account";
import { ReplayEngine } from "./domain/replay";
import { resolveFillPrice } from "./domain/matching";
import { resolveRiskExit } from "./domain/risk-exits";
import type { Candle } from "./domain/market";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root");

const replay = new ReplayEngine();
let account = new PaperAccount();
let timer: ReturnType<typeof setTimeout> | null = null;
let speed = 1;
let symbol = "BTCUSDT";
let marketDataSymbol = "BTCUSDT";
let marketDataInterval = "1m";
let side: Side = "LONG";
let orderType: "market" | "limit" = "market";
let limitPrice: number | null = null;
let candles: Candle[] = [];

type OrderStatus = "PENDING" | "FILLED" | "REJECTED" | "CANCELLED";
interface PaperOrder {
  id: number;
  symbol: string;
  side: Side;
  type: "market" | "limit";
  quantity: number;
  leverage: number;
  limitPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  createdIndex: number;
  status: OrderStatus;
  filledPrice: number | null;
  message?: string;
}
interface ActivityItem {
  timestamp: number | null;
  message: string;
  tone: "" | "positive" | "negative";
}
let orders: PaperOrder[] = [];
let activity: ActivityItem[] = [];
let nextOrderId = 1;
let positionOpenedIndex = -1;

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
      <div class="chart-card">
        <div class="chart-meta"><span>PRICE ACTION</span><span id="ohlc">Waiting for replay</span></div>
        <div id="chart" class="chart"></div>
        <div class="timeline"><div class="timeline-labels"><span id="start-time"></span><strong id="current-time"></strong><span id="end-time"></span></div><input id="seek" type="range" min="-1" max="119" value="-1" aria-label="Replay position"/></div>
        <div class="replay-controls"><button id="step-back" class="ghost">−1 bar</button><button id="play" class="primary">▶ Play</button><button id="step" class="ghost">+1 bar</button><label>Speed<select id="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option></select></label><button id="load-binance" class="ghost">Fetch Binance candles</button><input id="csv" type="file" accept=".csv,.txt" aria-label="Import CSV candles" hidden/><button id="import-csv" class="ghost">Import CSV</button></div>
        <p id="notice" class="notice" role="status">Demo dataset loaded. Fetch Binance futures candles or import a CSV.</p>
      </div>
      <section class="section-card">
        <div class="section-title"><div><span class="eyebrow">ACCOUNT</span><h2>Paper account</h2></div><span class="paper-tag">NO REAL ORDERS</span></div>
        <div class="stats-grid"><div><span>Wallet balance</span><strong id="wallet">$10,000.00</strong></div><div><span>Equity</span><strong id="equity">$10,000.00</strong></div><div><span>Unrealized P&amp;L</span><strong id="unrealized">$0.00</strong></div><div><span>Realized P&amp;L</span><strong id="realized">$0.00</strong></div><div><span>Used margin</span><strong id="margin">$0.00</strong></div><div><span>Available margin</span><strong id="available">$10,000.00</strong></div></div>
      </section>
    </section>
    <aside class="trade-column">
      <section class="section-card order-card">
        <div class="section-title"><div><span class="eyebrow">ORDER ENTRY</span><h2>Paper trade</h2></div><span class="paper-tag">SIM</span></div>
        <div class="side-toggle"><button id="long" class="side-button selected-long" type="button">Long / Buy</button><button id="short" class="side-button" type="button">Short / Sell</button></div>
        <label>Order type<select id="order-type"><option value="market">Market</option><option value="limit">Limit</option></select></label>
        <label>Quantity<input id="quantity" type="number" value="0.001" min="0.000001" step="any"/></label>
        <label>Leverage <strong id="lev-value">10×</strong><input id="leverage" type="range" min="1" max="50" value="10"/></label>
        <div class="preview"><div><span>Estimated notional</span><strong id="notional">$0.00</strong></div><div><span>Initial margin</span><strong id="initial-margin">$0.00</strong></div><div><span>Estimated entry fee</span><strong id="entry-fee">$0.00</strong></div></div>
        <div id="limit-wrap" hidden><label>Limit price<input id="limit-price" type="number" min="0" step="any"/></label></div>
        <div class="risk-grid"><label>Attached stop-loss<input id="sl-price" type="number" min="0" step="any" placeholder="Optional"/></label><label>Attached take-profit<input id="tp-price" type="number" min="0" step="any" placeholder="Optional"/></label></div>
        <button id="submit" class="submit-long" type="button">Open Long</button>
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
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (n: number | null) => n === null ? "Not started" : new Date(n).toLocaleString();
const chartHost = el<HTMLDivElement>("chart");
const chart: IChartApi = createChart(chartHost, {
  width: chartHost.clientWidth,
  height: 370,
  layout: { background: { color: "#0d1522" }, textColor: "#8290a6" },
  grid: { vertLines: { color: "#1c2939" }, horzLines: { color: "#1c2939" } },
  rightPriceScale: { borderColor: "#263449" },
  timeScale: { borderColor: "#263449", timeVisible: true, secondsVisible: false },
});
const series: ISeriesApi<"Candlestick"> = chart.addSeries(CandlestickSeries, {
  upColor: "#a5f04c", downColor: "#f15b70", borderUpColor: "#a5f04c",
  borderDownColor: "#f15b70", wickUpColor: "#a5f04c", wickDownColor: "#f15b70",
});
const resizeObserver = new ResizeObserver(() => chart.applyOptions({ width: chartHost.clientWidth }));
resizeObserver.observe(chartHost);

function stopTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
function snapshot() { return replay.snapshot(); }
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
  const acc = account.snapshot();
  el<HTMLElement>("wallet").textContent = money(acc.walletBalance);
  el<HTMLElement>("equity").textContent = money(acc.equity);
  el<HTMLElement>("unrealized").textContent = money(acc.unrealizedPnl);
  el<HTMLElement>("realized").textContent = money(acc.realizedPnl);
  el<HTMLElement>("margin").textContent = money(acc.usedMargin);
  el<HTMLElement>("available").textContent = money(acc.availableMargin);
  for (const id of ["unrealized", "realized"]) {
    const node = el<HTMLElement>(id);
    node.classList.toggle("positive", Number(node.textContent?.replace(/[^0-9.-]/g, "")) >= 0);
    node.classList.toggle("negative", Number(node.textContent?.replace(/[^0-9.-]/g, "")) < 0);
  }
  updatePreview();
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
function drawPosition() {
  const position = account.snapshot().position;
  const summary = el<HTMLElement>("position-summary");
  const closeButton = el<HTMLButtonElement>("close");
  closeButton.disabled = !position;
  if (!position) { summary.className = "empty"; summary.textContent = "No open position"; return; }
  const mark = snapshot().candle?.close ?? position.entryPrice;
  const pnl = (mark - position.entryPrice) * position.quantity * (position.side === "LONG" ? 1 : -1);
  const sl = position.stopLossPrice === null ? "None" : money(position.stopLossPrice);
  const tp = position.takeProfitPrice === null ? "None" : money(position.takeProfitPrice);
  summary.className = "";
  summary.innerHTML = `<div><b>${position.symbol} · ${position.side}</b></div><div>Size: ${position.quantity} · Leverage: ${position.leverage}×</div><div>Entry: ${money(position.entryPrice)} · Mark: ${money(mark)}</div><div>SL: ${sl} · TP: ${tp}</div><div class="${pnl >= 0 ? "positive" : "negative"}">Unrealized P&amp;L: ${money(pnl)}</div>`;
}
function drawActivity() {
  const list = el<HTMLDivElement>("activity-list");
  list.replaceChildren();
  list.className = activity.length ? "activity-list" : "activity-list empty";
  if (activity.length === 0) {
    list.textContent = "No order activity yet";
    return;
  }
  for (const item of activity) {
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
function recordActivity(message: string, tone: ActivityItem["tone"] = "") {
  activity.unshift({ timestamp: snapshot().timestamp, message, tone });
  activity = activity.slice(0, 25);
  drawActivity();
}
function clearTradingSession() {
  account = new PaperAccount();
  orders = [];
  activity = [];
  nextOrderId = 1;
  positionOpenedIndex = -1;
}
function processPendingOrders(candle: Candle, index: number) {
  for (const order of orders) {
    if (order.status !== "PENDING" || index <= order.createdIndex) continue;
    const fillPrice = resolveFillPrice(order, candle, index);
    if (fillPrice === null) continue;

    try {
      account.open({
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        price: fillPrice,
        leverage: order.leverage,
        stopLossPrice: order.stopLossPrice,
        takeProfitPrice: order.takeProfitPrice,
      });
      positionOpenedIndex = index;
      order.status = "FILLED";
      order.filledPrice = fillPrice;
      recordActivity(`FILLED #${order.id} ${order.side} ${order.quantity} @ ${money(fillPrice)}`, "positive");
    } catch (error) {
      order.status = "REJECTED";
      order.message = error instanceof Error ? error.message : String(error);
      recordActivity(`REJECTED #${order.id}: ${order.message}`, "negative");
    }
  }
}
function advanceOneBar() {
  const previous = snapshot().index;
  const state = replay.step();
  if (state.index >= 0 && state.index !== previous && state.candle) {
    processPendingOrders(state.candle, state.index);
    const position = account.snapshot().position;
    if (position && state.index > positionOpenedIndex) {
      const exit = resolveRiskExit(position, state.candle, state.index, positionOpenedIndex);
      if (exit) {
        account.close(exit.price);
        positionOpenedIndex = -1;
        recordActivity(`${exit.reason.replace("_", " ")} ${position.side} @ ${money(exit.price)}`, exit.reason === "STOP_LOSS" ? "negative" : "positive");
        el<HTMLElement>("notice").textContent = `${exit.reason.replace("_", " ")} triggered at ${money(exit.price)} under the documented OHLC fill model.`;
      }
    }
    account.updateMark(state.candle.close);
  }
  drawChart();
  return state;
}
function replayStep() {
  const state = advanceOneBar();
  if (state.status === "playing" && state.index < candles.length - 1) {
    timer = setTimeout(replayStep, Math.max(5, 1000 / speed));
  } else stopTimer();
}
function seekReplay(index: number) {
  stopTimer();
  replay.seek(index);
  // Event-journal reconstruction comes later. V1 clears trading history on
  // seek so future orders and positions can never leak into earlier bars.
  clearTradingSession();
  if (index >= 0) account.updateMark(candles[index].close);
  drawChart();
}
function setData(next: Candle[], message: string) {
  stopTimer();
  replay.load(next);
  candles = next;
  marketDataSymbol = el<HTMLSelectElement>("symbol").value;
  marketDataInterval = el<HTMLSelectElement>("timeframe").value;
  clearTradingSession();
  chart.timeScale().fitContent();
  el<HTMLElement>("notice").textContent = message;
  drawChart();
}
function parseCsv(text: string): Candle[] {
  const rows = text.trim().split(/\r?\n/);
  if (!rows.length) throw new Error("CSV is empty");
  const first = rows[0].toLowerCase();
  const start = /time|timestamp|open/.test(first) ? 1 : 0;
  const parsed = rows.slice(start).map((line, index) => {
    const row = line.split(/[;,\t]/).map((part) => part.trim().replace(/^"|"$/g, ""));
    if (row.length < 6) throw new Error(`CSV row ${index + start + 1} needs time, open, high, low, close, volume`);
    let time = Number(row[0]);
    if (!Number.isFinite(time)) time = Date.parse(row[0]);
    if (time > 0 && time < 100_000_000_000) time *= 1000;
    return { time, open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
  });
  // Validate all CSV candles before publishing the dataset to replay.
  replay.load(parsed);
  return parsed;
}
async function fetchBinance() {
  const button = el<HTMLButtonElement>("load-binance");
  button.disabled = true;
  el<HTMLElement>("notice").textContent = "Fetching public Binance USDⓈ-M futures candles…";
  try {
    const interval = el<HTMLSelectElement>("timeframe").value;
    const pair = el<HTMLSelectElement>("symbol").value;
    const url = new URL("https://fapi.binance.com/fapi/v1/klines");
    url.search = new URLSearchParams({ symbol: pair, interval, limit: "1000" }).toString();
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Binance returned HTTP ${response.status}`);
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) throw new Error("Unexpected Binance response");
    const rows = raw as unknown[][];
    const next: Candle[] = rows.map((r) => ({
      time: Number(r[0]), open: Number(r[1]), high: Number(r[2]),
      low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]),
    }));
    if (next.length === 0) throw new Error("Binance returned no candles");
    if (next[next.length - 1].time + (interval === "1m" ? 60_000 : interval === "5m" ? 300_000 : interval === "15m" ? 900_000 : 3_600_000) > Date.now()) next.pop();
    if (next.length === 0) throw new Error("No fully closed candles are available");
    symbol = pair;
    setData(next, `Loaded ${next.length} public Binance Futures ${symbol} candles. Replay is paused at the beginning.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    el<HTMLElement>("notice").textContent = `Unable to fetch Binance data: ${message}. You can import a CSV instead.`;
  } finally {
    button.disabled = false;
  }
}

el<HTMLButtonElement>("play").addEventListener("click", () => {
  if (snapshot().status === "playing") {
    stopTimer();
    replay.pause();
    drawChart();
    return;
  }
  if (snapshot().status === "ended") seekReplay(-1);
  replay.play();
  replayStep();
});
el<HTMLButtonElement>("step").addEventListener("click", () => {
  stopTimer();
  replay.pause();
  advanceOneBar();
});
el<HTMLButtonElement>("step-back").addEventListener("click", () => seekReplay(Math.max(-1, snapshot().index - 1)));
el<HTMLInputElement>("seek").addEventListener("input", (event) => seekReplay(Number((event.target as HTMLInputElement).value)));
el<HTMLSelectElement>("speed").addEventListener("change", (event) => {
  speed = Number((event.target as HTMLSelectElement).value);
  replay.setSpeed(speed);
});
el<HTMLSelectElement>("symbol").addEventListener("change", (event) => {
  const select = event.target as HTMLSelectElement;
  const pair = select.value;
  if (account.snapshot().position || orders.some((order) => order.status === "PENDING")) {
    select.value = symbol;
    el<HTMLElement>("notice").textContent = "Close the position and cancel pending orders before switching symbols.";
    return;
  }
  symbol = pair;
  el<HTMLElement>("symbol-title").textContent = `${symbol} PERPETUAL`;
  el<HTMLElement>("notice").textContent = "Symbol selected. Fetch Binance candles to load its historical data.";
});
el<HTMLSelectElement>("order-type").addEventListener("change", (event) => {
  orderType = (event.target as HTMLSelectElement).value as "market" | "limit";
  el<HTMLElement>("limit-wrap").hidden = orderType !== "limit";
  updatePreview();
});
el<HTMLInputElement>("limit-price").addEventListener("input", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  limitPrice = Number.isFinite(value) && value > 0 ? value : null;
});
el<HTMLInputElement>("quantity").addEventListener("input", updatePreview);
el<HTMLInputElement>("leverage").addEventListener("input", updatePreview);
el<HTMLButtonElement>("long").addEventListener("click", () => { side = "LONG"; updateSideUi(); });
el<HTMLButtonElement>("short").addEventListener("click", () => { side = "SHORT"; updateSideUi(); });
function updateSideUi() {
  el<HTMLButtonElement>("long").className = `side-button ${side === "LONG" ? "selected-long" : ""}`;
  el<HTMLButtonElement>("short").className = `side-button ${side === "SHORT" ? "selected-short" : ""}`;
  const button = el<HTMLButtonElement>("submit");
  button.textContent = side === "LONG" ? "Open Long" : "Open Short";
  button.className = side === "LONG" ? "submit-long" : "submit-short";
}
el<HTMLButtonElement>("submit").addEventListener("click", () => {
  try {
    const state = snapshot();
    if (!state.candle) throw new Error("Start replay before placing an order");
    if (symbol !== marketDataSymbol || el<HTMLSelectElement>("timeframe").value !== marketDataInterval) {
      throw new Error("Fetch or import candles for the selected symbol and timeframe before trading.");
    }
    if (state.index >= candles.length - 1) throw new Error("Replay is at the last candle. Seek to an earlier candle to trade.");
    if (account.snapshot().position) throw new Error("Close the open position before placing another order");
    if (orders.some((order) => order.status === "PENDING")) throw new Error("Cancel or wait for the pending order first");

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

    const order: PaperOrder = {
      id: nextOrderId++,
      symbol,
      side,
      type: orderType,
      quantity,
      leverage,
      limitPrice: orderType === "limit" ? limitPrice : null,
      stopLossPrice,
      takeProfitPrice,
      createdIndex: state.index,
      status: "PENDING",
      filledPrice: null,
    };
    orders.push(order);
    recordActivity(`SUBMITTED #${order.id} ${order.side} ${order.type.toUpperCase()} ${quantity}`);
    el<HTMLElement>("notice").textContent = order.type === "market"
      ? "Paper market order queued. It will fill at the next eligible candle open."
      : "Paper limit order queued. It can fill only on a future candle that reaches the limit; OHLC fills are approximate.";
    drawChart();
  } catch (error) {
    el<HTMLElement>("notice").textContent = error instanceof Error ? error.message : String(error);
  }
});
el<HTMLButtonElement>("close").addEventListener("click", () => {
  try {
    const price = snapshot().candle?.close;
    if (!price) throw new Error("No replay price available");
    const before = account.snapshot().walletBalance;
    account.close(price);
    positionOpenedIndex = -1;
    const walletDelta = account.snapshot().walletBalance - before;
    recordActivity(`CLOSED position @ ${money(price)} · wallet change ${money(walletDelta)}`, walletDelta >= 0 ? "positive" : "negative");
    el<HTMLElement>("notice").textContent = `Paper position closed at ${money(price)}.`;
    drawChart();
  } catch (error) {
    el<HTMLElement>("notice").textContent = error instanceof Error ? error.message : String(error);
  }
});
el<HTMLButtonElement>("reset").addEventListener("click", () => {
  clearTradingSession();
  drawChart();
  el<HTMLElement>("notice").textContent = "Paper account and order history reset. Replay position was not changed.";
});
el<HTMLButtonElement>("cancel-orders").addEventListener("click", () => {
  const pending = orders.filter((order) => order.status === "PENDING");
  for (const order of pending) {
    order.status = "CANCELLED";
    recordActivity(`CANCELLED #${order.id}`);
  }
  if (pending.length === 0) el<HTMLElement>("notice").textContent = "No pending orders to cancel.";
  else el<HTMLElement>("notice").textContent = `Cancelled ${pending.length} pending order(s).`;
  drawChart();
});
el<HTMLButtonElement>("load-binance").addEventListener("click", () => void fetchBinance());
el<HTMLButtonElement>("import-csv").addEventListener("click", () => el<HTMLInputElement>("csv").click());
el<HTMLInputElement>("csv").addEventListener("change", async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    setData(parseCsv(await file.text()), `Imported ${file.name}. Replay is paused at the beginning.`);
  } catch (error) {
    el<HTMLElement>("notice").textContent = error instanceof Error ? error.message : String(error);
  }
});
window.addEventListener("beforeunload", () => { stopTimer(); resizeObserver.disconnect(); chart.remove(); });

setData(demo, "Demo data loaded. Fetch historical Binance futures candles or import a CSV.");
el<HTMLSelectElement>("timeframe").addEventListener("change", () => {
  el<HTMLElement>("notice").textContent = "Change timeframe, then fetch Binance candles to load that interval.";
});
