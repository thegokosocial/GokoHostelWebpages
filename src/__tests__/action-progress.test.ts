import { createActionProgressRunner } from "@/lib/actionProgress";
import { describe, expect, it, vi } from "vitest";

describe("action progress runner", () => {
  it("does not show the delayed indicator for a fast action", async () => {
    vi.useFakeTimers();
    const states: Array<{ label: string; visible: boolean } | null> = [];
    const runner = createActionProgressRunner((state) => states.push(state), 180);
    await runner.run("Saving…", async () => "ok");
    expect(states).toEqual([{ label: "Saving…", visible: false }, null]);
    vi.useRealTimers();
  });

  it("shows progress for a slow action and clears it after failure", async () => {
    vi.useFakeTimers();
    const states: Array<{ label: string; visible: boolean } | null> = [];
    const runner = createActionProgressRunner((state) => states.push(state), 180);
    let rejectAction!: (error: Error) => void;
    const pending = runner.run("Updating orders…", () => new Promise<never>((_, reject) => { rejectAction = reject; }));
    vi.advanceTimersByTime(180);
    expect(states).toEqual([
      { label: "Updating orders…", visible: false },
      { label: "Updating orders…", visible: true },
    ]);
    rejectAction(new Error("network"));
    await expect(pending).rejects.toThrow("network");
    expect(states.at(-1)).toBeNull();
    expect(runner.isActive()).toBe(false);
    vi.useRealTimers();
  });

  it("ignores a second action while the first is active", async () => {
    const runner = createActionProgressRunner(() => {}, 180);
    let resolveFirst!: () => void;
    const first = runner.run("First", () => new Promise<void>((resolve) => { resolveFirst = resolve; }));
    await expect(runner.run("Second", async () => "ignored")).resolves.toBeUndefined();
    resolveFirst();
    await first;
  });

  it("cleans up when the action throws synchronously", async () => {
    const states: Array<{ label: string; visible: boolean } | null> = [];
    const runner = createActionProgressRunner((state) => states.push(state));
    await expect(runner.run("Deleting…", async () => { throw new Error("denied"); })).rejects.toThrow("denied");
    expect(runner.isActive()).toBe(false);
    expect(states.at(-1)).toBeNull();
  });

  it("cancels pending visibility when disposed", () => {
    vi.useFakeTimers();
    const states: Array<{ label: string; visible: boolean } | null> = [];
    const runner = createActionProgressRunner((state) => states.push(state), 180);
    void runner.run("Uploading…", () => new Promise<void>(() => {}));
    runner.dispose();
    vi.advanceTimersByTime(180);
    expect(states).toEqual([{ label: "Uploading…", visible: false }, null]);
    expect(runner.isActive()).toBe(false);
    vi.useRealTimers();
  });
});
