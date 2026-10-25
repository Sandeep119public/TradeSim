export interface IndexedReplayAction {
  /** Candle index after which the action was originally performed. -1 means before replay starts. */
  index: number;
}

/**
 * Ordered user-action journal for reproducible replay seeking.
 *
 * Actions are appended at the current replay index. Starting a new action in
 * the past drops actions from later indices, creating a deterministic branch.
 */
export class ReplayActionJournal<T extends IndexedReplayAction> {
  private entries: T[] = [];
  private cursor = 0;

  append(action: T, currentIndex: number): void {
    if (!Number.isInteger(currentIndex) || currentIndex < -1) {
      throw new RangeError("Current replay index must be an integer greater than or equal to -1");
    }
    if (!Number.isInteger(action.index) || action.index !== currentIndex) {
      throw new RangeError("Action index must match the current replay index");
    }

    this.entries = this.entries.filter((entry) => entry.index <= currentIndex);
    const previous = this.entries[this.entries.length - 1];
    if (previous && action.index < previous.index) {
      throw new Error("Replay actions must remain ordered by candle index");
    }
    this.entries.push({ ...action });
    // A newly appended action is applied immediately by the caller.
    this.cursor = this.entries.length;
  }

  rewind(): void {
    this.cursor = 0;
  }

  clear(): void {
    this.entries = [];
    this.cursor = 0;
  }

  /** Return and consume actions belonging to this candle in insertion order. */
  takeAt(index: number): T[] {
    if (!Number.isInteger(index) || index < -1) {
      throw new RangeError("Replay index must be an integer greater than or equal to -1");
    }
    const next = this.entries[this.cursor];
    if (next && next.index < index) {
      throw new Error(`Replay journal skipped action at candle index ${next.index}`);
    }
    const actions: T[] = [];
    while (this.cursor < this.entries.length && this.entries[this.cursor].index === index) {
      actions.push({ ...this.entries[this.cursor] });
      this.cursor += 1;
    }
    return actions;
  }

  snapshot(): T[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  get length(): number {
    return this.entries.length;
  }
}
