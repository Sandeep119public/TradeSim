export type Side = "LONG" | "SHORT";

export interface Position {
  symbol: string;
  side: Side;
  quantity: number;
  entryPrice: number;
  entryFee: number;
  leverage: number;
}

export interface AccountSnapshot {
  walletBalance: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  feesPaid: number;
  usedMargin: number;
  availableMargin: number;
  position: Position | null;
  markPrice: number | null;
}

export interface PaperAccountOptions {
  startingBalance?: number;
  feeRate?: number;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be finite and greater than zero`);
  return value;
}

/** Minimal one-way, single-position USDT-margined linear futures paper account. */
export class PaperAccount {
  private readonly startingBalance: number;
  private readonly feeRate: number;
  private walletBalance: number;
  private grossRealizedPnl = 0;
  private feesPaid = 0;
  private position: Position | null = null;
  private markPrice: number | null = null;

  constructor({ startingBalance = 10_000, feeRate = 0.0005 }: PaperAccountOptions = {}) {
    this.startingBalance = positive(startingBalance, "Starting balance");
    if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1) throw new RangeError("Fee rate must be in [0, 1)");
    this.feeRate = feeRate;
    this.walletBalance = this.startingBalance;
  }

  updateMark(price: number): AccountSnapshot {
    this.markPrice = positive(price, "Mark price");
    return this.snapshot();
  }

  open({ symbol, side, quantity, price, leverage }: {
    symbol: string; side: Side; quantity: number; price: number; leverage: number;
  }): AccountSnapshot {
    if (this.position) throw new Error("This v1 account supports one open position at a time");
    quantity = positive(quantity, "Quantity");
    price = positive(price, "Entry price");
    leverage = positive(leverage, "Leverage");
    if (!Number.isInteger(leverage) || leverage > 125) throw new RangeError("Leverage must be an integer from 1x to 125x");
    if (!symbol.trim()) throw new Error("Symbol is required");

    const notional = quantity * price;
    const fee = notional * this.feeRate;
    const requiredMargin = notional / leverage;
    const currentAvailable = this.snapshot().availableMargin;
    if (requiredMargin + fee > currentAvailable) throw new Error("Insufficient available margin");

    this.walletBalance -= fee;
    this.feesPaid += fee;
    this.position = { symbol: symbol.toUpperCase(), side, quantity, entryPrice: price, entryFee: fee, leverage };
    this.markPrice = price;
    return this.snapshot();
  }

  close(price: number, quantity?: number): AccountSnapshot {
    if (!this.position) throw new Error("No open position");
    price = positive(price, "Exit price");
    const old = this.position;
    const qty = quantity === undefined ? old.quantity : positive(quantity, "Close quantity");
    if (qty > old.quantity) throw new RangeError("Close quantity exceeds position quantity");

    const direction = old.side === "LONG" ? 1 : -1;
    const grossPnl = (price - old.entryPrice) * qty * direction;
    const allocatedEntryFee = old.entryFee * qty / old.quantity;
    const exitFee = price * qty * this.feeRate;

    this.walletBalance += grossPnl - exitFee;
    this.grossRealizedPnl += grossPnl;
    this.feesPaid += exitFee;
    if (qty === old.quantity) {
      this.position = null;
    } else {
      this.position = {
        ...old,
        quantity: old.quantity - qty,
        entryFee: old.entryFee - allocatedEntryFee,
      };
    }
    this.markPrice = price;
    return this.snapshot();
  }

  snapshot(): AccountSnapshot {
    const p = this.position;
    const mark = this.markPrice;
    const unrealizedPnl = p && mark !== null
      ? (mark - p.entryPrice) * p.quantity * (p.side === "LONG" ? 1 : -1)
      : 0;
    const usedMargin = p ? p.entryPrice * p.quantity / p.leverage : 0;
    const equity = this.walletBalance + unrealizedPnl;
    return {
      walletBalance: this.walletBalance,
      equity,
      realizedPnl: this.grossRealizedPnl - this.feesPaid,
      unrealizedPnl,
      feesPaid: this.feesPaid,
      usedMargin,
      availableMargin: equity - usedMargin,
      position: p ? { ...p } : null,
      markPrice: mark,
    };
  }
}
