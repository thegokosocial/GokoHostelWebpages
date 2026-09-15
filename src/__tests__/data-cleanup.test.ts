import { describe, it, expect } from "vitest";

describe("Daily ledger uniqueness", () => {
  it("same date + account should not create duplicates", () => {
    const entries = [
      { date: "2026-06-14", accountId: 1 },
      { date: "2026-06-14", accountId: 1 }, // duplicate
      { date: "2026-06-14", accountId: 2 }, // different account, OK
    ];

    const seen = new Set<string>();
    const duplicates: typeof entries = [];
    for (const e of entries) {
      const key = `${e.date}:${e.accountId}`;
      if (seen.has(key)) {
        duplicates.push(e);
      } else {
        seen.add(key);
      }
    }

    expect(duplicates.length).toBe(1);
    expect(duplicates[0].date).toBe("2026-06-14");
    expect(duplicates[0].accountId).toBe(1);
  });

  it("different dates for same account are not duplicates", () => {
    const entries = [
      { date: "2026-06-13", accountId: 1 },
      { date: "2026-06-14", accountId: 1 },
    ];

    const keys = entries.map((e) => `${e.date}:${e.accountId}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(2);
  });
});
