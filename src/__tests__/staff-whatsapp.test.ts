import { describe, expect, it, vi } from "vitest";
import { bookingWhatsAppNumber } from "@/lib/bookingWhatsApp";
import { clearStaffWhatsAppDraft, parseStaffWhatsAppDraft, staffWhatsAppFallback, staffWhatsAppLinks, STAFF_WHATSAPP_TTL } from "@/lib/staffWhatsApp";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";

describe("staff WhatsApp routing", () => {
  it("targets Business with an encoded draft and a fallback containing no guest content", () => {
    const message = "Hi Ada ❤️\nBalance ₹500 & review https://goko.test/review/x?a=1#test;end";
    const links = staffWhatsAppLinks({ phone: "447700900123", message, section: "reviews" }, "https://gokohostel.com");
    expect(links.business).toContain(";scheme=whatsapp;package=com.whatsapp.w4b;");
    const query = new URLSearchParams(links.business.split("?")[1].split("#Intent")[0]);
    expect(query.get("phone")).toBe("447700900123");
    expect(query.get("text")).toBe(message);
    const fallback = decodeURIComponent(links.business.split("S.browser_fallback_url=")[1].split(";end")[0]);
    expect(fallback).toBe("https://gokohostel.com/admin?section=reviews&whatsappBusinessUnavailable=1");
    expect(fallback).not.toContain("447700900123");
    expect(fallback).not.toContain(encodeURIComponent(message));
    expect(new URL(links.defaultApp).searchParams.get("text")).toBe(message);
  });
  it.each(["bookings", "reviews"] as const)("marks and cleans the %s fallback without losing URL state", (section) => {
    const links = staffWhatsAppLinks({ phone: "447700900123", message: "Hi", section }, "https://gokohostel.com");
    const fallbackUrl = decodeURIComponent(links.business.split("S.browser_fallback_url=")[1].split(";end")[0]);
    const result = staffWhatsAppFallback(`${fallbackUrl}&tab=active#guest`);
    expect(result).toEqual({
      unavailable: true,
      hadMarker: true,
      cleanUrl: `/admin?section=${section}&tab=active#guest`,
    });
  });
  it("cleans invalid or copied fallback markers without reporting Business unavailable", () => {
    expect(staffWhatsAppFallback("https://goko.test/admin?section=reviews&whatsappBusinessUnavailable=0")).toEqual({
      unavailable: false,
      hadMarker: true,
      cleanUrl: "/admin?section=reviews",
    });
    expect(staffWhatsAppFallback("https://goko.test/admin?section=reviews")).toEqual({
      unavailable: false,
      hadMarker: false,
      cleanUrl: "/admin?section=reviews",
    });
  });
  it.each([
    ["11111 11111", "911111111111"], ["+1 202-555-0100", "12025550100"], ["+44 7700 900123", "447700900123"],
    ["0044 7700 900123", "447700900123"], ["+1 202-555-0147", "12025550147"],
    ["123", ""], ["call 2025550100", ""], ["000", ""], ["++447700900123", ""],
  ])("normalizes %s without changing explicit international codes", (input, expected) => {
    expect(bookingWhatsAppNumber(input)).toBe(expected);
    if (expected) expect(staffWhatsAppLinks({ phone: expected, message: "Hi", section: "bookings" }, "https://goko.test").business).toContain(`phone=${expected}&`);
  });
  it("restores only a valid current-owner unexpired draft", () => {
    const now = Date.now();
    const draft = { owner: "admin", phone: "447700900123", message: "Hi", section: "bookings", createdAt: now };
    expect(parseStaffWhatsAppDraft(JSON.stringify(draft), "admin", now)).toEqual(draft);
    expect(parseStaffWhatsAppDraft(JSON.stringify(draft), "other", now)).toBeNull();
    expect(parseStaffWhatsAppDraft(JSON.stringify(draft), "admin", now + STAFF_WHATSAPP_TTL)).toBeNull();
    expect(parseStaffWhatsAppDraft(JSON.stringify(draft), "admin", now - 1)).toBeNull();
    expect(parseStaffWhatsAppDraft("invalid", "admin")).toBeNull();
    expect(parseStaffWhatsAppDraft(JSON.stringify({ ...draft, section: "https://evil.test" }), "admin", now)).toBeNull();
  });
});

// Execute actual handlers with browser/API doubles; no native app or production call.
function handler(file: string, name: string, globals: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Node | undefined;
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) callback = node.initializer;
    ts.forEachChild(node, find);
  }
  find(source);
  if (!callback) throw new Error(`Missing ${name}`);
  const context = { ...globals, handler: undefined as unknown as (...args: any[]) => any };
  runInNewContext(ts.transpileModule(`globalThis.handler = ${callback.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.handler;
}

describe("staff WhatsApp workflows", () => {
  const provider = "src/components/admin/StaffWhatsAppProvider.tsx";
  const file = "src/components/admin/ReviewAskTab.tsx";
  const guest = { checkinId: 1, guestName: "Ada", guestContact: "+44 7700 900123", bookingId: "G-1" };
  function review(fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: "abc" }) })) {
    const globals = {
      preparing: { current: false }, bookingWhatsAppNumber, setSendError: vi.fn(), setSendingId: vi.fn(),
      apiCall: fetcher, settings: { review_message_template: "Rate {REVIEW_URL}\nAgain {REVIEW_URL}" },
      window: { location: { origin: "https://goko.test" } }, prepareWhatsApp: vi.fn(), loadGuests: vi.fn(),
    };
    return { ...globals, run: handler(file, "handleSendWhatsApp", globals) };
  }
  it("prepares once and leaves native launch for an explicit tap", async () => {
    const state = review();
    await state.run(guest);
    expect(state.apiCall).toHaveBeenCalledTimes(1);
    expect(state.prepareWhatsApp).toHaveBeenCalledWith(guest.guestContact, "Rate https://goko.test/review/abc\nAgain https://goko.test/review/abc", "reviews");
    expect(state.preparing.current).toBe(false);
  });
  it("does not count invalid phones or concurrent taps", async () => {
    const state = review();
    await state.run({ ...guest, guestContact: "12" });
    expect(state.apiCall).not.toHaveBeenCalled();
    state.preparing.current = true;
    await state.run(guest);
    expect(state.apiCall).not.toHaveBeenCalled();
  });
  it("shows preparation errors and releases the busy state", async () => {
    const state = review(vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Denied" }) }));
    await state.run(guest);
    expect(state.prepareWhatsApp).not.toHaveBeenCalled();
    expect(state.setSendError).toHaveBeenCalledWith("Denied");
    expect(state.preparing.current).toBe(false);
  });
  it.each(["network", "invalid-json", "missing-token"])("handles review %s without launching or retaining a partial draft", async (failure) => {
    const state = review(vi.fn().mockImplementation(async () => {
      if (failure === "network") throw new Error("offline");
      return { ok: true, json: async () => {
        if (failure === "invalid-json") throw new Error("invalid JSON");
        return {};
      } };
    }));
    await state.run(guest);
    expect(state.prepareWhatsApp).not.toHaveBeenCalled();
    expect(state.preparing.current).toBe(false);
    expect(state.setSendingId).toHaveBeenLastCalledWith(null);
    expect(state.setSendError.mock.calls.some(([message]) => !!message)).toBe(true);
  });
  it.each([
    ["Android Chrome", true, 1], ["Android Chrome", false, 0],
    ["iPhone Safari", true, 0], ["Macintosh Chrome", true, 0],
  ])("prepares on %s with immediate launch=%s", (userAgent, launch, expected) => {
    const globals = {
      active: { current: true }, bookingWhatsAppNumber, username: "staff-a", STAFF_WHATSAPP_KEY: "draft",
      setDraft: vi.fn(), setNotice: vi.fn(), setBusinessUnavailable: vi.fn(), setAttempted: vi.fn(), launchBusiness: vi.fn(),
      sessionStorage: { setItem: vi.fn() }, navigator: { userAgent },
    };
    const run = handler(provider, "prepare", globals);
    run("+65 8123 4567", "Hi ❤️\nReview here", "bookings", launch);
    expect(globals.setDraft).toHaveBeenCalledWith(expect.objectContaining({ phone: "6581234567", owner: "staff-a", message: "Hi ❤️\nReview here" }));
    expect(globals.launchBusiness).toHaveBeenCalledTimes(expected);
    globals.active.current = false;
    run("+65 8123 4567", "Late API response after logout", "reviews");
    expect(globals.setDraft).toHaveBeenCalledTimes(1);
  });
  it("saves a recoverable draft before attempting Business and never launches default WhatsApp automatically", () => {
    const storage = new Map<string, string>();
    const globals = {
      STAFF_WHATSAPP_TTL, STAFF_WHATSAPP_KEY: "draft", staffWhatsAppLinks, dismiss: vi.fn(),
      setAttempted: vi.fn(), setNotice: vi.fn(),
      sessionStorage: { setItem: (key: string, value: string) => storage.set(key, value) },
      window: { location: { origin: "https://goko.test", assign: vi.fn(() => {
        expect(storage.has("draft")).toBe(true);
        throw new Error("Browser blocked intent");
      }) }, open: vi.fn() },
    };
    const run = handler(provider, "launchBusiness", globals);
    const draft = { phone: "447700900123", message: "Hello", section: "reviews", owner: "admin", createdAt: Date.now() };
    run(draft);
    run(draft);
    expect(globals.window.location.assign).toHaveBeenCalledTimes(2);
    expect(globals.window.location.assign).toHaveBeenCalledWith(expect.stringContaining("package=com.whatsapp.w4b"));
    expect(globals.window.open).not.toHaveBeenCalled();
    expect(globals.setNotice).toHaveBeenCalledWith(expect.stringContaining("could not open"));
    expect(parseStaffWhatsAppDraft(storage.get("draft")!, "admin")).toEqual(draft);
  });
  it("restores a valid fallback draft with an unavailable warning and retry state", () => {
    const source = readFileSync(provider, "utf8");
    expect(source).toContain("fallback.unavailable && saved");
    expect(source).toContain("setAttempted(true)");
    expect(source).toContain("setBusinessUnavailable(true)");
    expect(source).toContain("WhatsApp Business isn&apos;t installed or available.");
    expect(source).toContain("window.history.replaceState(window.history.state, \"\", fallback.cleanUrl)");
  });
  it("allows selectable text after clipboard denial", async () => {
    const setNotice = vi.fn();
    const run = handler(provider, "copy", { navigator: { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } }, setNotice });
    await run("Hello");
    expect(setNotice).toHaveBeenCalledWith("Copy unavailable. Select and copy the text below.");
  });
  it("clears only the staff draft on logout/dismissal and tolerates disabled storage", () => {
    const removeItem = vi.fn();
    try {
      vi.stubGlobal("sessionStorage", { removeItem });
      clearStaffWhatsAppDraft();
      expect(removeItem).toHaveBeenCalledExactlyOnceWith("gokoStaffWhatsAppDraft");
      removeItem.mockImplementation(() => { throw new Error("blocked"); });
      expect(clearStaffWhatsAppDraft).not.toThrow();
    } finally { vi.unstubAllGlobals(); }
  });
  it("keeps the panel in memory if storage fails; retries contain no API calls", () => {
    const globals = {
      STAFF_WHATSAPP_TTL, STAFF_WHATSAPP_KEY: "draft", staffWhatsAppLinks, dismiss: vi.fn(),
      setAttempted: vi.fn(), setNotice: vi.fn(),
      sessionStorage: { setItem: vi.fn(() => { throw new Error("blocked"); }) },
      window: { location: { origin: "https://goko.test", assign: vi.fn() }, open: vi.fn() },
    };
    const run = handler("src/components/admin/StaffWhatsAppProvider.tsx", "launchBusiness", globals);
    const draft = { phone: "447700900123", message: "Hello", section: "reviews", owner: "admin", createdAt: Date.now() };
    run(draft);
    run(draft);
    expect(globals.window.open).toHaveBeenCalledTimes(2);
    expect(globals.window.location.assign).not.toHaveBeenCalled();
    expect(globals.dismiss).not.toHaveBeenCalled();
    run({ ...draft, createdAt: Date.now() - STAFF_WHATSAPP_TTL });
    expect(globals.dismiss).toHaveBeenCalledTimes(1);
  });
});
