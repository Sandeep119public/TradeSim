import { describe, expect, it } from "vitest";
import { ReplaySession, type HistoricalFunding, type OrderIntent } from "./session-simulator";
import type { Candle } from "./market";
import type { MarkPriceCandle } from "./mark-price";

const intervalMs = 60_000;
const start = 1_700_000_000_000;

function candle(index: number, values: Partial<Candle> = {}): Candle {
  const open = values.open ?? 100;
  const close = values.close ?? 100;
  return {
    time: start + index * intervalMs,
    open,
    high: Math.max(105, open, close),
    low: Math.min(95, open, close),
    close,
    volume: 10,
    ...values,
  };
}

const marketOrder = (side: "LONG" | "SHORT", risk: Pick<OrderIntent, "stopLossPrice" | "takeProfitPrice">): OrderIntent => ({
  symbol: "BTCUSDT",
  side,
  type: "market",
  quantity: 1,
  leverage: 10,
  limitPrice: null,
  ...risk,
});

function riskSession(
  side: "LONG" | "SHORT",
  risk: Pick<OrderIntent, "stopLossPrice" | "takeProfitPrice">,
  trade: Partial<Candle>,
  mark?: Partial<MarkPriceCandle>,
) {
  const candles = [candle(0), candle(1), candle(2, trade)];
  const marks = mark ? candles.map((bar, index) => ({
    time: bar.time,
    open: 100,
    high: 105,
    low: 95,
    close: 100,
    ...(index === 2 ? mark : {}),
  })) : [];
  const session = new ReplaySession(candles, [], marks, {
    candleIntervalMs: intervalMs,
    account: { startingBalance: side === "LONG" ? 10.45 : 10.55, feeRate: 0, maintenanceMarginRate: 0.005 },
  });
  session.step();
  session.submitOrder(marketOrder(side, risk));
  session.step();
  session.step();
  return session;
}

function entryCandleSession(
  side: "LONG" | "SHORT",
  risk: Pick<OrderIntent, "stopLossPrice" | "takeProfitPrice">,
  entryCandle: Partial<Candle>,
  options: {
    startingBalance?: number;
    feeRate?: number;
    limitPrice?: number;
    funding?: HistoricalFunding[];
  } = {},
) {
  const candles = [candle(0), candle(1, entryCandle), candle(2)];
  const session = new ReplaySession(candles, options.funding ?? [], [], {
    candleIntervalMs: intervalMs,
    account: {
      startingBalance: options.startingBalance ?? 1_000,
      feeRate: options.feeRate ?? 0,
      maintenanceMarginRate: 0.005,
    },
  });
  session.step();
  session.submitOrder({
    ...marketOrder(side, risk),
    type: options.limitPrice === undefined ? "market" : "limit",
    limitPrice: options.limitPrice ?? null,
  });
  session.step();
  return session;
}

describe("ReplaySession funding and reconstruction", () => {
  it("keeps recorded-action awareness after seeking to the beginning", () => {
    const session = new ReplaySession([candle(0), candle(1)], [], [], {
      candleIntervalMs: intervalMs,
    });

    expect(session.hasRecordedUserActions()).toBe(false);
    session.step();
    expect(session.hasRecordedUserActions()).toBe(false);
    session.submitOrder(marketOrder("LONG", { stopLossPrice: null, takeProfitPrice: null }));
    expect(session.hasRecordedUserActions()).toBe(true);
    expect(session.ordersSnapshot()).toHaveLength(1);
    expect(session.activitySnapshot()).toHaveLength(1);

    session.seek(-1);
    expect(session.snapshot().index).toBe(-1);
    expect(session.accountSnapshot().position).toBeNull();
    expect(session.ordersSnapshot()).toEqual([]);
    expect(session.activitySnapshot()).toEqual([]);
    expect(session.hasRecordedUserActions()).toBe(true);

    session.step();
    expect(session.ordersSnapshot()).toHaveLength(1);
    expect(session.activitySnapshot()[0].message).toContain("SUBMITTED #1");
  });

  it("skips a missing event mark when no mark observation is available by settlement", () => {
    const candles = [candle(0), candle(1), candle(2, { open: 100, high: 205, low: 95, close: 200 })];
    const funding: HistoricalFunding[] = [{ fundingTime: candles[2].time, fundingRate: 0.01, markPrice: null }];
    const session = new ReplaySession(candles, funding, [], {
      candleIntervalMs: intervalMs,
      account: { feeRate: 0 },
    });
    session.step();
    session.submitOrder(marketOrder("LONG", { stopLossPrice: null, takeProfitPrice: null }));
    session.step();
    session.step();

    expect(session.accountSnapshot().netFunding).toBe(0);
    expect(session.accountSnapshot().walletBalance).toBe(10_000);
    expect(session.activitySnapshot()[0]).toMatchObject({
      timestamp: funding[0].fundingTime,
      message: expect.stringContaining("FUNDING SKIPPED"),
      tone: "",
    });
  });

  it("uses an exact settlement-time mark open and preserves funding direction for both sides and signs", () => {
    for (const side of ["LONG", "SHORT"] as const) {
      for (const fundingRate of [0.01, -0.01]) {
        const candles = [candle(0), candle(1), candle(2, { open: 100, close: 200 })];
        const funding: HistoricalFunding[] = [{ fundingTime: candles[2].time, fundingRate, markPrice: null }];
        const marks = candles.map((bar, index) => ({
          time: bar.time,
          open: index === 2 ? 150 : 100,
          high: index === 2 ? 205 : 105,
          low: index === 2 ? 95 : 95,
          close: index === 2 ? 190 : 100,
        }));
        const session = new ReplaySession(candles, funding, marks, {
          candleIntervalMs: intervalMs,
          account: { feeRate: 0 },
        });
        session.step();
        session.submitOrder(marketOrder(side, { stopLossPrice: null, takeProfitPrice: null }));
        session.step();
        session.step();

        const expected = (side === "LONG" ? -1 : 1) * 150 * fundingRate;
        expect(session.accountSnapshot().netFunding).toBeCloseTo(expected);
        expect(session.activitySnapshot()[0].message).toContain(Math.abs(expected).toFixed(2));
      }
    }
  });

  it("prefers a valid event mark price over the exact-boundary candle open", () => {
    const candles = [candle(0), candle(1), candle(2)];
    const funding: HistoricalFunding[] = [{ fundingTime: candles[2].time, fundingRate: 0.01, markPrice: 123 }];
    const marks = candles.map((bar) => ({ time: bar.time, open: 150, high: 155, low: 145, close: 152 }));
    const session = new ReplaySession(candles, funding, marks, {
      candleIntervalMs: intervalMs,
      account: { feeRate: 0 },
    });
    session.step();
    session.submitOrder(marketOrder("LONG", { stopLossPrice: null, takeProfitPrice: null }));
    session.step();
    session.step();
    expect(session.accountSnapshot().netFunding).toBeCloseTo(-1.23);
  });

  it("uses the last completed mark close across a missing candle, never the settlement candle close", () => {
    const candles = [candle(0), candle(1), candle(2, { open: 100, close: 200 })];
    const funding: HistoricalFunding[] = [{ fundingTime: candles[2].time, fundingRate: 0.01, markPrice: null }];
    const marks: MarkPriceCandle[] = [
      { time: candles[0].time, open: 100, high: 105, low: 95, close: 105 },
    ];
    const session = new ReplaySession(candles, funding, marks, {
      candleIntervalMs: intervalMs,
      account: { feeRate: 0 },
    });
    session.step();
    session.submitOrder(marketOrder("LONG", { stopLossPrice: null, takeProfitPrice: null }));
    session.step();
    session.step();

    expect(session.accountSnapshot().netFunding).toBeCloseTo(-1.05);
  });

  it("reconstructs funding once across backward and forward seeking", () => {
    const candles = [candle(0), candle(1), candle(2), candle(3)];
    const funding: HistoricalFunding[] = [{ fundingTime: candles[2].time, fundingRate: 0.01, markPrice: 100 }];
    const session = new ReplaySession(candles, funding, [], {
      candleIntervalMs: intervalMs,
      account: { feeRate: 0 },
    });
    session.step();
    session.submitOrder(marketOrder("LONG", { stopLossPrice: null, takeProfitPrice: null }));
    session.step();
    session.step();
    const afterSettlement = session.accountSnapshot();

    session.seek(1);
    expect(session.accountSnapshot().netFunding).toBe(0);
    session.seek(2);
    expect(session.accountSnapshot()).toEqual(afterSettlement);
    expect(session.activitySnapshot().filter((item) => item.message.startsWith("FUNDING "))).toHaveLength(1);
    session.seek(1);
    session.step();
    expect(session.accountSnapshot()).toEqual(afterSettlement);
    expect(session.activitySnapshot().filter((item) => item.message.startsWith("FUNDING "))).toHaveLength(1);
  });

  it("matches uninterrupted account/order/activity state after seek, then removes later actions on a branch", () => {
    const candles = [
      candle(0, { open: 100, close: 100 }),
      candle(1, { open: 101, close: 102 }),
      candle(2, { open: 102, close: 103 }),
      candle(3, { open: 103, close: 110 }),
      candle(4, { open: 111, close: 112 }),
    ];
    const funding: HistoricalFunding[] = [{ fundingTime: candles[2].time, fundingRate: 0.001, markPrice: 102 }];
    const session = new ReplaySession(candles, funding, [], {
      candleIntervalMs: intervalMs,
      account: { startingBalance: 1_000, feeRate: 0.001 },
    });
    session.step();
    session.submitOrder(marketOrder("LONG", { stopLossPrice: null, takeProfitPrice: null }));
    session.step(); // first order fills at candle 1 open
    session.step(); // funding settles at candle 2 open
    session.step(); // candle 3 updates mark before manual close
    session.closePosition();
    session.submitOrder(marketOrder("SHORT", { stopLossPrice: null, takeProfitPrice: null }));
    session.step(); // second order fills at candle 4 open
    const uninterrupted = {
      account: session.accountSnapshot(),
      orders: session.ordersSnapshot(),
      activity: session.activitySnapshot(),
    };

    session.seek(1);
    session.seek(4);
    expect({ account: session.accountSnapshot(), orders: session.ordersSnapshot(), activity: session.activitySnapshot() }).toEqual(uninterrupted);

    session.seek(1);
    session.resetAccount(); // branches here and drops the later close and second submission
    session.seek(4);
    expect(session.accountSnapshot().position).toBeNull();
    expect(session.accountSnapshot().walletBalance).toBe(1_000);
    expect(session.ordersSnapshot()).toEqual([]);
    expect(session.activitySnapshot()).toEqual([]);
  });
});

describe("ReplaySession risk-exit precedence", () => {
  it("fills a long market order at the open, then executes its stop on the entry candle", () => {
    const session = entryCandleSession("LONG", { stopLossPrice: 95, takeProfitPrice: null }, {
      open: 100, high: 105, low: 90, close: 98,
    }, { feeRate: 0.001 });
    const order = session.ordersSnapshot()[0];
    expect(order).toMatchObject({ status: "FILLED", filledPrice: 100 });
    expect(session.activitySnapshot()[0].message).toContain("STOP LOSS LONG @ $95.00");
    expect(session.accountSnapshot()).toMatchObject({
      position: null,
      walletBalance: 994.805,
      equity: 994.805,
      realizedPnl: -5.195,
      unrealizedPnl: 0,
      feesPaid: 0.195,
      netFunding: 0,
    });
  });

  it("fills a short market order at the open, then executes its stop on the entry candle", () => {
    const session = entryCandleSession("SHORT", { stopLossPrice: 105, takeProfitPrice: null }, {
      open: 100, high: 110, low: 95, close: 102,
    }, { feeRate: 0.001 });
    expect(session.ordersSnapshot()[0]).toMatchObject({ status: "FILLED", filledPrice: 100 });
    expect(session.activitySnapshot()[0].message).toContain("STOP LOSS SHORT @ $105.00");
    expect(session.accountSnapshot()).toMatchObject({
      position: null,
      walletBalance: 994.795,
      equity: 994.795,
      realizedPnl: -5.205,
      unrealizedPnl: 0,
      netFunding: 0,
    });
    expect(session.accountSnapshot().feesPaid).toBeCloseTo(0.205);
  });

  it("liquidates long and short market entries when their entry candle crosses liquidation", () => {
    const long = entryCandleSession("LONG", { stopLossPrice: null, takeProfitPrice: null }, {
      open: 100, high: 105, low: 85, close: 95,
    }, { startingBalance: 10.45 });
    const short = entryCandleSession("SHORT", { stopLossPrice: null, takeProfitPrice: null }, {
      open: 100, high: 115, low: 95, close: 105,
    }, { startingBalance: 10.55 });
    expect(long.activitySnapshot()[0].message).toContain("LIQUIDATION LONG @ $90.00");
    expect(short.activitySnapshot()[0].message).toContain("LIQUIDATION SHORT @ $110.00");
    expect(long.ordersSnapshot()[0].status).toBe("FILLED");
    expect(short.ordersSnapshot()[0].status).toBe("FILLED");
  });

  it("keeps liquidation first when liquidation and stop are both touched on entry", () => {
    const long = entryCandleSession("LONG", { stopLossPrice: 85, takeProfitPrice: null }, {
      open: 100, high: 105, low: 80, close: 90,
    }, { startingBalance: 10.45 });
    const short = entryCandleSession("SHORT", { stopLossPrice: 115, takeProfitPrice: null }, {
      open: 100, high: 120, low: 95, close: 110,
    }, { startingBalance: 10.55 });
    expect(long.activitySnapshot()[0].message).toContain("LIQUIDATION LONG @ $90.00");
    expect(short.activitySnapshot()[0].message).toContain("LIQUIDATION SHORT @ $110.00");
  });

  it("keeps stop-loss ahead of take-profit on entry when liquidation is not reached", () => {
    const session = entryCandleSession("LONG", { stopLossPrice: 95, takeProfitPrice: 105 }, {
      open: 100, high: 110, low: 90, close: 100,
    });
    expect(session.activitySnapshot()[0].message).toContain("STOP LOSS LONG @ $95.00");
    expect(session.ordersSnapshot()[0]).toMatchObject({ status: "FILLED", filledPrice: 100 });
  });

  it("checks the full limit-fill candle conservatively for risk exits", () => {
    const session = entryCandleSession("LONG", { stopLossPrice: 90, takeProfitPrice: null }, {
      open: 100, high: 105, low: 90, close: 100,
    }, { startingBalance: 9.5, limitPrice: 95 });
    expect(session.ordersSnapshot()[0]).toMatchObject({ status: "FILLED", filledPrice: 95 });
    expect(session.activitySnapshot()[0].message).toContain("STOP LOSS LONG @ $90.00");
    expect(session.accountSnapshot().position).toBeNull();
  });

  it("keeps a market entry open when its fill candle touches no risk threshold", () => {
    const session = entryCandleSession("LONG", { stopLossPrice: 95, takeProfitPrice: 105 }, {
      open: 100, high: 104, low: 96, close: 101,
    });
    expect(session.ordersSnapshot()[0]).toMatchObject({ status: "FILLED", filledPrice: 100 });
    expect(session.activitySnapshot()[0].message).toContain("FILLED #1");
    expect(session.accountSnapshot().position?.side).toBe("LONG");
  });

  it("reconstructs an entry-candle exit without duplicate fills, fees, or activity", () => {
    const candles = [candle(0), candle(1, { open: 100, high: 105, low: 90, close: 98 }), candle(2)];
    const funding: HistoricalFunding[] = [{ fundingTime: candles[1].time, fundingRate: 0.01, markPrice: 100 }];
    const session = new ReplaySession(candles, funding, [], {
      candleIntervalMs: intervalMs,
      account: { startingBalance: 1_000, feeRate: 0.001 },
    });
    session.step();
    session.submitOrder(marketOrder("LONG", { stopLossPrice: 95, takeProfitPrice: null }));
    session.step();
    const afterEntryExit = {
      snapshot: session.snapshot(),
      account: session.accountSnapshot(),
      orders: session.ordersSnapshot(),
      activity: session.activitySnapshot(),
    };
    expect(afterEntryExit.account.netFunding).toBe(0); // Settlement is before the entry fill.
    expect(afterEntryExit.orders[0]).toMatchObject({ status: "FILLED", filledPrice: 100 });
    expect(afterEntryExit.activity.filter((item) => item.message.startsWith("FILLED"))).toHaveLength(1);
    expect(afterEntryExit.activity.filter((item) => item.message.startsWith("STOP LOSS"))).toHaveLength(1);

    session.step();
    expect(session.accountSnapshot()).toMatchObject({
      position: null,
      walletBalance: afterEntryExit.account.walletBalance,
      equity: afterEntryExit.account.equity,
      realizedPnl: afterEntryExit.account.realizedPnl,
      feesPaid: afterEntryExit.account.feesPaid,
      netFunding: afterEntryExit.account.netFunding,
    });
    expect(session.activitySnapshot()).toEqual(afterEntryExit.activity);
    session.seek(0);
    expect(session.accountSnapshot().position).toBeNull();
    session.step();
    expect({
      snapshot: session.snapshot(),
      account: session.accountSnapshot(),
      orders: session.ordersSnapshot(),
      activity: session.activitySnapshot(),
    }).toEqual(afterEntryExit);
    session.seek(1);
    expect(session.accountSnapshot()).toEqual(afterEntryExit.account);
    expect(session.activitySnapshot().filter((item) => item.message.startsWith("FILLED"))).toHaveLength(1);
    expect(session.activitySnapshot().filter((item) => item.message.startsWith("STOP LOSS"))).toHaveLength(1);
  });

  it("gives liquidation priority over a long stop touched in the same candle", () => {
    const session = riskSession("LONG", { stopLossPrice: 85, takeProfitPrice: null }, { open: 100, low: 80, high: 105, close: 90 });
    expect(session.activitySnapshot()[0].message).toContain("LIQUIDATION LONG @ $90.00");
    expect(session.accountSnapshot().position).toBeNull();
  });

  it("gives liquidation priority over a short stop touched in the same candle", () => {
    const session = riskSession("SHORT", { stopLossPrice: 120, takeProfitPrice: null }, { open: 100, low: 95, high: 120, close: 110 });
    expect(session.activitySnapshot()[0].message).toContain("LIQUIDATION SHORT @ $110.00");
    expect(session.accountSnapshot().position).toBeNull();
  });

  it("gives liquidation priority when a long take-profit and liquidation are both touched", () => {
    const session = riskSession("LONG", { stopLossPrice: null, takeProfitPrice: 120 }, { open: 100, low: 80, high: 120, close: 100 });
    expect(session.activitySnapshot()[0].message).toContain("LIQUIDATION LONG @ $90.00");
  });

  it("gives liquidation priority when a short take-profit and liquidation are both touched", () => {
    const session = riskSession("SHORT", { stopLossPrice: null, takeProfitPrice: 80 }, { open: 100, low: 70, high: 120, close: 100 });
    expect(session.activitySnapshot()[0].message).toContain("LIQUIDATION SHORT @ $110.00");
  });

  it("fills long and short gaps through liquidation at the worse candle open", () => {
    const long = riskSession("LONG", { stopLossPrice: null, takeProfitPrice: null }, { open: 80, low: 75, high: 95, close: 85 });
    const short = riskSession("SHORT", { stopLossPrice: null, takeProfitPrice: null }, { open: 120, low: 105, high: 125, close: 115 });
    expect(long.activitySnapshot()[0].message).toContain("LIQUIDATION LONG @ $80.00");
    expect(short.activitySnapshot()[0].message).toContain("LIQUIDATION SHORT @ $120.00");
  });

  it("uses mark-price OHLC for liquidation even when trade-price OHLC disagrees", () => {
    const markTouch = riskSession("LONG", { stopLossPrice: null, takeProfitPrice: null }, { open: 100, low: 95, high: 105, close: 100 }, { open: 100, low: 85, high: 105, close: 100 });
    expect(markTouch.activitySnapshot()[0].message).toContain("LIQUIDATION LONG @ $90.00");

    const tradeOnlyTouch = riskSession("LONG", { stopLossPrice: 85, takeProfitPrice: null }, { open: 100, low: 80, high: 105, close: 90 }, { open: 100, low: 95, high: 105, close: 100 });
    expect(tradeOnlyTouch.activitySnapshot()[0].message).toContain("STOP LOSS LONG @ $85.00");
  });

  it("does not exit when neither liquidation nor attached risk levels are touched", () => {
    const session = riskSession("LONG", { stopLossPrice: 85, takeProfitPrice: 120 }, { open: 100, low: 95, high: 110, close: 100 });
    expect(session.activitySnapshot()[0].message).toContain("FILLED #1");
    expect(session.accountSnapshot().position?.side).toBe("LONG");
  });
});

describe("ReplaySession input integrity", () => {
  it("copies submitted order intent so caller mutation cannot change a later reconstruction", () => {
    const session = new ReplaySession([candle(0), candle(1), candle(2)], [], [], {
      candleIntervalMs: intervalMs,
      account: { feeRate: 0 },
    });
    session.step();
    const intent = marketOrder("LONG", { stopLossPrice: null, takeProfitPrice: null });
    session.submitOrder(intent);
    intent.symbol = "ETHUSDT";
    intent.quantity = 9;
    session.step();
    const expected = {
      account: session.accountSnapshot(),
      orders: session.ordersSnapshot(),
      activity: session.activitySnapshot(),
    };

    expect(expected.orders[0]).toMatchObject({ symbol: "BTCUSDT", quantity: 1, status: "FILLED" });
    session.seek(0);
    session.step();
    expect({ account: session.accountSnapshot(), orders: session.ordersSnapshot(), activity: session.activitySnapshot() }).toEqual(expected);
  });

  it("settles an exact duplicate funding event only once", () => {
    const candles = [candle(0), candle(1), candle(2)];
    const event: HistoricalFunding = { fundingTime: candles[2].time, fundingRate: 0.01, markPrice: 100 };
    const session = new ReplaySession(candles, [event, { ...event }], [], {
      candleIntervalMs: intervalMs,
      account: { feeRate: 0 },
    });
    session.step();
    session.submitOrder(marketOrder("LONG", { stopLossPrice: null, takeProfitPrice: null }));
    session.step();
    session.step();

    expect(session.accountSnapshot().netFunding).toBe(-1);
    expect(session.activitySnapshot().filter((item) => item.message.startsWith("FUNDING "))).toHaveLength(1);
  });

  it("rejects malformed funding timestamps and rates at construction", () => {
    const invalidTime = { fundingTime: Number.NaN, fundingRate: 0.01, markPrice: 100 };
    const fractionalTime = { fundingTime: start + 0.5, fundingRate: 0.01, markPrice: 100 };
    const unsafeTime = { fundingTime: Number.MAX_SAFE_INTEGER + 1, fundingRate: 0.01, markPrice: 100 };
    const invalidRate = { fundingTime: start, fundingRate: Number.POSITIVE_INFINITY, markPrice: 100 };
    expect(() => new ReplaySession([candle(0)], [invalidTime], [], { candleIntervalMs: intervalMs })).toThrow(/Funding timestamp/);
    expect(() => new ReplaySession([candle(0)], [fractionalTime], [], { candleIntervalMs: intervalMs })).toThrow(/Funding timestamp/);
    expect(() => new ReplaySession([candle(0)], [unsafeTime], [], { candleIntervalMs: intervalMs })).toThrow(/Funding timestamp/);
    expect(() => new ReplaySession([candle(0)], [invalidRate], [], { candleIntervalMs: intervalMs })).toThrow(/Funding rate/);
    expect(() => new ReplaySession([candle(0)], [
      { fundingTime: start, fundingRate: 0.01, markPrice: 100 },
      { fundingTime: start, fundingRate: -0.01, markPrice: 100 },
    ], [], { candleIntervalMs: intervalMs })).toThrow(/Conflicting funding events/);
  });

  it("rejects duplicate or malformed mark candles before replay starts", () => {
    const mark: MarkPriceCandle = { time: start, open: 100, high: 105, low: 95, close: 101 };
    expect(() => new ReplaySession([candle(0)], [], [mark, { ...mark }], { candleIntervalMs: intervalMs })).toThrow(/timestamps/);
    expect(() => new ReplaySession([candle(0)], [], [{ ...mark, time: start + 0.5 }], { candleIntervalMs: intervalMs })).toThrow(/timestamps/);
    expect(() => new ReplaySession([candle(0)], [], [{ ...mark, time: Number.MAX_SAFE_INTEGER + 1 }], { candleIntervalMs: intervalMs })).toThrow(/timestamps/);
    expect(() => new ReplaySession([candle(0)], [], [{ ...mark, high: 90 }], { candleIntervalMs: intervalMs })).toThrow(/OHLC/);
  });

  it("records a malformed pending limit as rejected instead of crashing replay", () => {
    const session = new ReplaySession([candle(0), candle(1)], [], [], {
      candleIntervalMs: intervalMs,
      account: { feeRate: 0 },
    });
    session.step();
    session.submitOrder({ ...marketOrder("LONG", { stopLossPrice: null, takeProfitPrice: null }), type: "limit" });

    expect(() => session.step()).not.toThrow();
    expect(session.ordersSnapshot()[0].status).toBe("REJECTED");
    expect(session.accountSnapshot().position).toBeNull();
    expect(session.accountSnapshot().walletBalance).toBe(10_000);
  });
});
