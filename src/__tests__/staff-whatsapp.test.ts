import { describe, expect, it, vi } from "vitest";
import { bookingWhatsAppNumber } from "@/lib/bookingWhatsApp";
import { clearStaffWhatsAppDraft, parseStaffWhatsAppDraft, readStaffWhatsAppPreference, staffWhatsAppFallback, staffWhatsAppLinks, writeStaffWhatsAppPreference, STAFF_WHATSAPP_TTL } from "@/lib/staffWhatsApp";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";

describe("staff WhatsApp routing", () => {
  it("targets Business with an encoded draft and a fallback containing no guest content", () => {
    const message = "Hi Ada ❤️\nBalance ₹500 & review https://goko.test/review/x?a=1#test;end";
    const links = staffWhatsAppLinks({ phone: "447700900123", message, section: "reviews" }, "https://gokohostel.com");
    expect(links.business).toContain(";scheme=whatsapp;package=com.whatsapp.w4b;");
    expect(links.regular).toContain(";scheme=whatsapp;package=com.whatsapp;");
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
      unavailable: "business",
      hadMarker: true,
      cleanUrl: `/admin?section=${section}&tab=active#guest`,
    });
  });
  it("cleans invalid or copied fallback markers without reporting Business unavailable", () => {
    expect(staffWhatsAppFallback("https://goko.test/admin?section=reviews&whatsappBusinessUnavailable=0")).toEqual({
      unavailable: null,
      hadMarker: true,
      cleanUrl: "/admin?section=reviews",
    });
    expect(staffWhatsAppFallback("https://goko.test/admin?section=reviews")).toEqual({
      unavailable: null,
      hadMarker: false,
      cleanUrl: "/admin?section=reviews",
    });
  });
  it("identifies a missing regular Android package", () => {
    const links = staffWhatsAppLinks({ phone: "447700900123", message: "Private bill", section: "foodOrders" }, "https://goko.test");
    const fallbackUrl = decodeURIComponent(links.regular.split("S.browser_fallback_url=")[1].split(";end")[0]);
    expect(fallbackUrl).not.toContain("447700900123");
    expect(fallbackUrl).not.toContain("Private bill");
    expect(staffWhatsAppFallback(fallbackUrl)).toEqual({
      unavailable: "regular",
      hadMarker: true,
      cleanUrl: "/admin?section=foodOrders",
    });
  });
  it("stores a device preference per username and fails safely", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    expect(readStaffWhatsAppPreference("staff-a", storage)).toBe("ask");
    expect(writeStaffWhatsAppPreference("staff-a", "business", storage)).toBe(true);
    expect(writeStaffWhatsAppPreference("staff-b", "regular", storage)).toBe(true);
    expect(readStaffWhatsAppPreference("staff-a", storage)).toBe("business");
    expect(readStaffWhatsAppPreference("staff-b", storage)).toBe("regular");
    values.set("gokoStaffWhatsAppPreference:staff-a", "invalid");
    expect(readStaffWhatsAppPreference("staff-a", storage)).toBe("ask");
    expect(readStaffWhatsAppPreference("staff-a", { getItem: () => { throw new Error("blocked"); } })).toBe("ask");
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
    ["ask", 0], ["business", 1], ["regular", 1],
  ])("prepares a draft and honors the %s device preference", (savedPreference, expectedLaunches) => {
    const globals = {
      active: { current: true }, bookingWhatsAppNumber, username: "staff-a", STAFF_WHATSAPP_KEY: "draft",
      setDraft: vi.fn(), setNotice: vi.fn(), setUnavailableApp: vi.fn(), setPreference: vi.fn(),
      readStaffWhatsAppPreference: vi.fn(() => savedPreference), launchPreferred: vi.fn(), sessionStorage: { setItem: vi.fn() }, navigator: { userAgent: "Android Chrome" },
    };
    const run = handler(provider, "prepare", globals);
    run("+65 8123 4567", "Hi ❤️\nReview here", "bookings");
    expect(globals.setDraft).toHaveBeenCalledWith(expect.objectContaining({ phone: "6581234567", owner: "staff-a", message: "Hi ❤️\nReview here" }));
    expect(globals.launchPreferred).toHaveBeenCalledTimes(expectedLaunches);
    if (savedPreference !== "ask") expect(globals.launchPreferred).toHaveBeenCalledWith(expect.objectContaining({ phone: "6581234567" }), savedPreference);
    globals.active.current = false;
    run("+65 8123 4567", "Late API response after logout", "reviews");
    expect(globals.setDraft).toHaveBeenCalledTimes(1);
  });
  it("does not auto-launch a stale Business preference outside Android", () => {
    const globals = {
      active: { current: true }, bookingWhatsAppNumber, username: "staff-a", STAFF_WHATSAPP_KEY: "draft",
      setDraft: vi.fn(), setNotice: vi.fn(), setUnavailableApp: vi.fn(), setPreference: vi.fn(),
      readStaffWhatsAppPreference: vi.fn(() => "business"), launchPreferred: vi.fn(), sessionStorage: { setItem: vi.fn() }, navigator: { userAgent: "iPhone Safari" },
    };
    handler(provider, "prepare", globals)("+65 8123 4567", "Hello", "reviews");
    expect(globals.setPreference).toHaveBeenCalledWith("ask");
    expect(globals.launchPreferred).not.toHaveBeenCalled();
  });
  it.each([
    ["business", "package=com.whatsapp.w4b"], ["regular", "package=com.whatsapp;"],
  ] as const)("opens preferred %s in a new context while preserving the recoverable draft", (app, packageName) => {
    const storage = new Map<string, string>();
    const globals = {
      STAFF_WHATSAPP_TTL, STAFF_WHATSAPP_KEY: "draft", staffWhatsAppLinks, dismiss: vi.fn(),
      setNotice: vi.fn(),
      sessionStorage: { setItem: (key: string, value: string) => storage.set(key, value) },
      window: { location: { origin: "https://goko.test" }, open: vi.fn() }, navigator: { userAgent: "Android Chrome" },
    };
    const run = handler(provider, "launchPreferred", globals);
    const draft = { phone: "447700900123", message: "Hello", section: "reviews", owner: "admin", createdAt: Date.now() };
    run(draft, app);
    expect(globals.window.open).toHaveBeenCalledWith(expect.stringContaining(packageName), "_blank", "noopener,noreferrer");
    expect(parseStaffWhatsAppDraft(storage.get("draft")!, "admin")).toEqual(draft);
  });
  it("uses wa.me for a regular preference outside Android", () => {
    const globals = {
      STAFF_WHATSAPP_TTL, STAFF_WHATSAPP_KEY: "draft", staffWhatsAppLinks, dismiss: vi.fn(), setNotice: vi.fn(),
      sessionStorage: { setItem: vi.fn() }, window: { location: { origin: "https://goko.test" }, open: vi.fn() }, navigator: { userAgent: "iPhone Safari" },
    };
    const run = handler(provider, "launchPreferred", globals);
    run({ phone: "447700900123", message: "Hello", section: "reviews", owner: "admin", createdAt: Date.now() }, "regular");
    expect(globals.window.open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\//), "_blank", "noopener,noreferrer");
  });
  it("restores a valid fallback draft with an app-specific warning and real link choices", () => {
    const source = readFileSync(provider, "utf8");
    expect(source).toContain("fallback.unavailable && saved");
    expect(source).toContain("setUnavailableApp(fallback.unavailable)");
    expect(source).toContain("Open WhatsApp Business");
    expect(source).toContain("Open regular WhatsApp");
    expect(source).not.toContain("window.location.assign");
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
  it("keeps recovery controls when storage and automatic opening fail", () => {
    const globals = {
      STAFF_WHATSAPP_TTL, STAFF_WHATSAPP_KEY: "draft", staffWhatsAppLinks, dismiss: vi.fn(),
      setNotice: vi.fn(),
      sessionStorage: { setItem: vi.fn(() => { throw new Error("blocked"); }) },
      window: { location: { origin: "https://goko.test" }, open: vi.fn(() => { throw new Error("blocked"); }) }, navigator: { userAgent: "Android Chrome" },
    };
    const run = handler("src/components/admin/StaffWhatsAppProvider.tsx", "launchPreferred", globals);
    const draft = { phone: "447700900123", message: "Hello", section: "reviews", owner: "admin", createdAt: Date.now() };
    run(draft, "business");
    expect(globals.window.open).toHaveBeenCalledTimes(1);
    expect(globals.dismiss).not.toHaveBeenCalled();
    run({ ...draft, createdAt: Date.now() - STAFF_WHATSAPP_TTL }, "business");
    expect(globals.dismiss).toHaveBeenCalledTimes(1);
  });
  it.each([
    [true, true], [false, false],
  ])("updates the preference UI only when device storage succeeds (saved=%s)", (saved, shouldUpdate) => {
    const setSaveError = vi.fn();
    const setPreference = vi.fn();
    const choose = handler("src/components/admin/ManagementPreferences.tsx", "choose", {
      username: "staff-a",
      writeStaffWhatsAppPreference: vi.fn(() => saved),
      setSaveError,
      setPreference,
    });
    choose("regular");
    expect(setSaveError).toHaveBeenCalledWith(!saved);
    expect(setPreference).toHaveBeenCalledTimes(shouldUpdate ? 1 : 0);
    if (shouldUpdate) expect(setPreference).toHaveBeenCalledWith("regular");
  });
  it("keeps the preference controls accessible and reports storage failures", () => {
    const source = readFileSync("src/components/admin/ManagementPreferences.tsx", "utf8");
    expect(source).toContain('type="radio"');
    expect(source).toContain('role="alert"');
    expect(source).toContain("Could not save this preference on your device");
  });
});
