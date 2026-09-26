import { describe, expect, it } from "vitest";
import {
  appendTaskNoteEntry,
  buildShoppingItemsFromInput,
  canCollaborateOnTask,
  parseShoppingItems,
  parseTaskNotes,
  shoppingProgress,
  sortShoppingItemsForDisplay,
  toggleShoppingItemInList,
} from "@/lib/taskNotesShopping";

describe("taskNotesShopping helpers", () => {
  it("appends notes and rejects empty or over-capacity journals", () => {
    const first = appendTaskNoteEntry("[]", "Hello", "staff");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(parseTaskNotes(first.json)).toHaveLength(1);
    expect(appendTaskNoteEntry(first.json, "   ", "staff").ok).toBe(false);
    let json = "[]";
    for (let i = 0; i < 50; i += 1) {
      const next = appendTaskNoteEntry(json, `n${i}`, "staff");
      expect(next.ok).toBe(true);
      if (next.ok) json = next.json;
    }
    expect(appendTaskNoteEntry(json, "one more", "staff").ok).toBe(false);
  });

  it("builds shopping items and preserves bought state by id", () => {
    const built = buildShoppingItemsFromInput(["Milk", "Eggs"]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const withBought = parseShoppingItems(built.json).map((item, index) => index === 0 ? { ...item, bought: true, boughtBy: "staff", boughtAt: "t" } : item);
    const updated = buildShoppingItemsFromInput(
      withBought.map((item) => ({ id: item.id, label: item.label === "Milk" ? "Milk 2L" : item.label })),
      JSON.stringify(withBought),
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const milk = updated.items.find((item) => item.label === "Milk 2L");
    expect(milk?.bought).toBe(true);
  });

  it("toggles shopping items and reports allBought / anyOpen", () => {
    const built = buildShoppingItemsFromInput(["A", "B"]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const [first, second] = built.items;
    const one = toggleShoppingItemInList(built.json, first.id, "staff");
    expect(one.ok && one.allBought).toBe(false);
    if (!one.ok) return;
    const both = toggleShoppingItemInList(one.json, second.id, "staff");
    expect(both.ok && both.allBought).toBe(true);
    if (!both.ok) return;
    const undone = toggleShoppingItemInList(both.json, first.id, "staff");
    expect(undone.ok && undone.anyOpen).toBe(true);
  });

  it("gates collaborators to manager, assignee, or follower", () => {
    expect(canCollaborateOnTask({ canManage: true })).toBe(true);
    expect(canCollaborateOnTask({ canManage: false, actorUserId: 2, assigneeUserId: 2 })).toBe(true);
    expect(canCollaborateOnTask({ canManage: false, actorUsername: "staff", followerUsernamesJson: '["staff"]' })).toBe(true);
    expect(canCollaborateOnTask({ canManage: false, actorUsername: "stranger", followerUsernamesJson: '["staff"]', actorUserId: 9, assigneeUserId: 1 })).toBe(false);
  });

  it("reports shopping progress and sorts open items first", () => {
    const items = [
      { id: "1", label: "Bought", bought: true },
      { id: "2", label: "Open", bought: false },
    ];
    expect(shoppingProgress(items)).toEqual({ bought: 1, total: 2 });
    expect(sortShoppingItemsForDisplay(items).map((item) => item.label)).toEqual(["Open", "Bought"]);
  });
});
