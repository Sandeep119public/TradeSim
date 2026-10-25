import { describe, expect, it } from "vitest";
import { ReplayActionJournal } from "./session-journal";

interface Action { index: number; value: string }

describe("ReplayActionJournal", () => {
  it("replays same-candle actions in insertion order", () => {
    const journal = new ReplayActionJournal<Action>();
    journal.append({ index: 2, value: "submit" }, 2);
    journal.append({ index: 2, value: "cancel" }, 2);
    journal.rewind();
    expect(journal.takeAt(-1)).toEqual([]);
    expect(journal.takeAt(0)).toEqual([]);
    expect(journal.takeAt(1)).toEqual([]);
    expect(journal.takeAt(2)).toEqual([
      { index: 2, value: "submit" },
      { index: 2, value: "cancel" },
    ]);
    expect(journal.takeAt(3)).toEqual([]);
  });

  it("branches from the current candle and removes later actions", () => {
    const journal = new ReplayActionJournal<Action>();
    journal.append({ index: 1, value: "A" }, 1);
    journal.append({ index: 4, value: "future" }, 4);
    journal.rewind();
    expect(journal.takeAt(0)).toEqual([]);
    expect(journal.takeAt(1)).toEqual([{ index: 1, value: "A" }]);

    journal.append({ index: 1, value: "branch" }, 1);
    expect(journal.snapshot()).toEqual([
      { index: 1, value: "A" },
      { index: 1, value: "branch" },
    ]);
    journal.rewind();
    expect(journal.takeAt(0)).toEqual([]);
    expect(journal.takeAt(1)).toEqual([
      { index: 1, value: "A" },
      { index: 1, value: "branch" },
    ]);
  });

  it("rejects out-of-order or skipped actions", () => {
    const journal = new ReplayActionJournal<Action>();
    expect(() => journal.append({ index: 2, value: "bad" }, 1)).toThrow(RangeError);
    journal.append({ index: 1, value: "A" }, 1);
    journal.rewind();
    expect(() => journal.takeAt(2)).toThrow(/skipped action/);
  });
});
