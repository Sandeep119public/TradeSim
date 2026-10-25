import { describe, expect, it } from "vitest";
import { PaperAccount } from "./paper-account";

describe("PaperAccount", () => {
  it("calculates leverage-based initial margin and entry fee", () => {
    const account = new PaperAccount({ startingBalance: 1_000, feeRate: 0.001 });
    const state = account.open({ symbol: "BTCUSDT", side: "LONG", quantity: 0.1, price: 50_000, leverage: 10 });
    expect(state.usedMargin).toBe(500);
    expect(state.feesPaid).toBe(5);
    expect(state.walletBalance).toBe(995);
    expect(state.realizedPnl).toBe(-5);
  });

  it("tracks long and short unrealized PnL", () => {
    const long = new PaperAccount({ feeRate: 0 });
    long.open({ symbol: "BTCUSDT", side: "LONG", quantity: 1, price: 100, leverage: 10 });
    expect(long.updateMark(110).unrealizedPnl).toBe(10);

    const short = new PaperAccount({ feeRate: 0 });
    short.open({ symbol: "BTCUSDT", side: "SHORT", quantity: 1, price: 100, leverage: 10 });
    expect(short.updateMark(90).unrealizedPnl).toBe(10);
  });

  it("reports net realized PnL and wallet balance after closing", () => {
    const account = new PaperAccount({ startingBalance: 1_000, feeRate: 0.001 });
    account.open({ symbol: "BTCUSDT", side: "LONG", quantity: 1, price: 100, leverage: 10 });
    const state = account.close(110);
    expect(state.position).toBeNull();
    expect(state.realizedPnl).toBeCloseTo(9.79);
    expect(state.walletBalance).toBeCloseTo(1_009.79);
    expect(state.feesPaid).toBeCloseTo(0.21);
  });

  it("stores attached stop-loss and take-profit levels on the position", () => {
    const account = new PaperAccount({ feeRate: 0 });
    const state = account.open({
      symbol: "BTCUSDT", side: "LONG", quantity: 1, price: 100, leverage: 10,
      stopLossPrice: 95, takeProfitPrice: 110,
    });
    expect(state.position?.stopLossPrice).toBe(95);
    expect(state.position?.takeProfitPrice).toBe(110);
  });

  it("rejects stop-loss and take-profit levels on the wrong side of entry", () => {
    const account = new PaperAccount({ feeRate: 0 });
    expect(() => account.open({
      symbol: "BTCUSDT", side: "LONG", quantity: 1, price: 100, leverage: 10,
      stopLossPrice: 101,
    })).toThrow(/Stop-loss must be below entry/);
    expect(() => account.open({
      symbol: "BTCUSDT", side: "SHORT", quantity: 1, price: 100, leverage: 10,
      takeProfitPrice: 101,
    })).toThrow(/Take-profit must be above entry/);
  });

  it("rejects entries beyond available margin", () => {
    const account = new PaperAccount({ startingBalance: 100, feeRate: 0 });
    expect(() => account.open({ symbol: "BTCUSDT", side: "LONG", quantity: 10, price: 100, leverage: 1 })).toThrow(/Insufficient/);
  });
});
