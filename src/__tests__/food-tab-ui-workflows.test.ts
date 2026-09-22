import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { canLookupFoodTab, foodTabUncheckedMessage, unpaidFoodCheckoutMessage } from "@/lib/foodTab";

const ROOT = resolve(__dirname, "../..");

const BEDS = "src/components/admin/AdminBeds.tsx";
const TIMELINE = "src/components/admin/AdminTimeline.tsx";
const DASHBOARD = "src/components/admin/AdminDashboard.tsx";
const PANEL = "src/components/admin/booking-dashboard/BookingDetailPanel.tsx";

const CHECKOUT_UIS = [BEDS, TIMELINE, DASHBOARD, PANEL] as const;

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function afterFoodTabLookup(
  pendingTab: number,
  pendingOrders: number,
  guestName: string,
  fallbackConfirm: string,
) {
  if (pendingTab > 0) {
    return { warn: true, message: unpaidFoodCheckoutMessage(guestName, pendingTab, pendingOrders) };
  }
  return { warn: false, message: fallbackConfirm };
}

type TabOk = { ok: true; pendingTab: number; pendingOrders: number };
type TabLookup = () => Promise<TabOk | { ok: false }>;

const FALLBACK_BEDS_TIMELINE = "Checkout this guest?";
const UNPAID_TAB: TabOk = { ok: true, pendingTab: 45000, pendingOrders: 2 };
const PAID_TAB: TabOk = { ok: true, pendingTab: 0, pendingOrders: 0 };
const LOOKUP_FAILED = { ok: false as const };

/** Occupied bed Checkout (AdminBeds.checkoutBed / AdminTimeline.act checkoutBed). */
async function occupiedCheckoutConfirm(
  guestName: string,
  guestContact: string | undefined,
  lookup: TabLookup,
): Promise<{ lookedUp: boolean; message: string; warn: boolean }> {
  if (!canLookupFoodTab({ contact: guestContact })) {
    return { lookedUp: false, warn: true, message: foodTabUncheckedMessage("no-phone") };
  }
  try {
    const d = await lookup();
    if (!d.ok) {
      return { lookedUp: true, warn: true, message: foodTabUncheckedMessage("lookup-failed") };
    }
    const next = afterFoodTabLookup(d.pendingTab, d.pendingOrders, guestName || "This guest", FALLBACK_BEDS_TIMELINE);
    return { lookedUp: true, ...next };
  } catch {
    return { lookedUp: true, warn: true, message: foodTabUncheckedMessage("lookup-failed") };
  }
}

/** Unassigned list Checkout (AdminBeds.openGuestCheckout → modal). */
async function unassignedCheckoutModal(
  guestName: string,
  lookup: TabLookup,
): Promise<{ confirmLabel: string; message: string; warn: boolean }> {
  try {
    const d = await lookup();
    if (!d.ok) {
      return {
        warn: true,
        message: foodTabUncheckedMessage("lookup-failed"),
        confirmLabel: "Checkout anyway",
      };
    }
    const next = afterFoodTabLookup(d.pendingTab, d.pendingOrders, guestName || "This guest", "Yes, Checkout");
    return {
      ...next,
      confirmLabel: d.pendingTab > 0 ? "Checkout anyway" : "Yes, Checkout",
    };
  } catch {
    return {
      warn: true,
      message: foodTabUncheckedMessage("lookup-failed"),
      confirmLabel: "Checkout anyway",
    };
  }
}

/** Calendar Check Out Guest (BookingDetailPanel.promptCheckOut). */
async function bookingPromptCheckOut(
  guestName: string,
  lookup: TabLookup,
  contact = "9876543210",
): Promise<{ title: string; confirmLabel: string | undefined; message: string; warn: boolean }> {
  if (!canLookupFoodTab({ contact })) {
    return {
      title: "Check Out Guest",
      confirmLabel: "Check out anyway",
      warn: true,
      message: foodTabUncheckedMessage("no-phone"),
    };
  }
  let lookupOk = false;
  let pendingTab = 0;
  let pendingOrders = 0;
  try {
    const d = await lookup();
    if (d.ok) {
      lookupOk = true;
      pendingTab = Number(d.pendingTab) || 0;
      pendingOrders = Number(d.pendingOrders) || 0;
    }
  } catch {
    lookupOk = false;
  }
  if (!lookupOk) {
    return {
      title: "Check Out Guest",
      confirmLabel: "Check out anyway",
      warn: true,
      message: foodTabUncheckedMessage("lookup-failed"),
    };
  }
  const next = afterFoodTabLookup(pendingTab, pendingOrders, guestName, `Check out ${guestName}?`);
  if (next.warn) {
    return { title: "Unpaid food bill", confirmLabel: "Check out anyway", ...next };
  }
  return { title: "Check Out Guest", confirmLabel: undefined, ...next };
}

/** Dashboard today-checkout (AdminDashboard.handleCheckoutClick). Live lookup. */
async function dashboardCheckoutClick(opts: {
  contact?: string;
  checkinId?: number | null;
  lookup?: TabLookup;
}): Promise<{ openedModal: boolean; immediateCheckout: boolean; confirm?: string }> {
  if (!canLookupFoodTab({ contact: opts.contact, checkinId: opts.checkinId })) {
    return { openedModal: false, immediateCheckout: false, confirm: foodTabUncheckedMessage("no-phone") };
  }
  try {
    const d = await (opts.lookup || (async () => PAID_TAB))();
    if (!d.ok) {
      return { openedModal: false, immediateCheckout: false, confirm: foodTabUncheckedMessage("lookup-failed") };
    }
    if (d.pendingTab > 0) return { openedModal: true, immediateCheckout: false };
    return { openedModal: false, immediateCheckout: true };
  } catch {
    return { openedModal: false, immediateCheckout: false, confirm: foodTabUncheckedMessage("lookup-failed") };
  }
}

async function dashboardPayThenCheckout(
  orderIds: number[],
  markPaid: () => Promise<{ ok: boolean }>,
): Promise<{ checkout: boolean }> {
  if (orderIds.length > 0) {
    const payRes = await markPaid();
    if (!payRes.ok) return { checkout: false };
  }
  return { checkout: true };
}

function sliceFrom(src: string, start: string, minLen = 1200): string {
  const i = src.indexOf(start);
  expect(i).toBeGreaterThan(-1);
  return src.slice(i, i + minLen);
}

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTsx(p));
    else if (/\.(tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

describe("food-tab UI checkout workflows", () => {
  it("1. Beds occupied unpaid tab: confirm is unpaid copy, not Checkout this guest?", async () => {
    const beds = readSrc(BEDS);
    const fn = sliceFrom(beds, "const checkoutBed = async");
    expect(fn).toContain('action: "getPendingFoodTab"');
    expect(fn).toContain("unpaidFoodCheckoutMessage");
    expect(fn).toContain('let msg = "Checkout this guest?"');
    expect(fn.indexOf("getPendingFoodTab")).toBeLessThan(fn.indexOf("if (!confirm(msg))"));

    const click = await occupiedCheckoutConfirm("Ada", "9876543210", async () => UNPAID_TAB);
    expect(click.lookedUp).toBe(true);
    expect(click.warn).toBe(true);
    expect(click.message).toBe(
      "Ada has an unpaid food tab of ₹450 (2 unpaid orders). Check out anyway?",
    );
    expect(click.message).not.toBe(FALLBACK_BEDS_TIMELINE);
    expect(click.message).toBe(
      afterFoodTabLookup(45000, 2, "Ada", FALLBACK_BEDS_TIMELINE).message,
    );
  });

  it("2. Beds occupied paid/empty tab: fallback Checkout this guest?", async () => {
    const beds = readSrc(BEDS);
    expect(sliceFrom(beds, "const checkoutBed = async")).toContain(
      'if (d.pendingTab > 0)',
    );

    const paid = await occupiedCheckoutConfirm("Ada", "9876543210", async () => PAID_TAB);
    expect(paid.warn).toBe(false);
    expect(paid.message).toBe(FALLBACK_BEDS_TIMELINE);
    expect(paid.message).not.toContain("unpaid food tab");

    const empty = await occupiedCheckoutConfirm("Ada", "9876543210", async () => PAID_TAB);
    expect(empty).toEqual(paid);
  });

  it("3. Beds occupied empty guestContact warns instead of silent checkout", async () => {
    const beds = readSrc(BEDS);
    const fn = sliceFrom(beds, "const checkoutBed = async");
    const guard = fn.indexOf("canLookupFoodTab");
    const lookup = fn.indexOf("getPendingFoodTab");
    expect(guard).toBeGreaterThan(-1);
    expect(fn).toContain('foodTabUncheckedMessage("no-phone")');
    expect(lookup).toBeGreaterThan(guard);

    const skipped = await occupiedCheckoutConfirm("Ada", "", async () => {
      throw new Error("must not look up");
    });
    expect(skipped.lookedUp).toBe(false);
    expect(skipped.warn).toBe(true);
    expect(skipped.message).toBe(foodTabUncheckedMessage("no-phone"));
    expect(skipped.message).not.toBe(FALLBACK_BEDS_TIMELINE);

    const garbage = await occupiedCheckoutConfirm("Ada", "12", async () => {
      throw new Error("must not look up");
    });
    expect(garbage.lookedUp).toBe(false);
    expect(garbage.message).toBe(foodTabUncheckedMessage("no-phone"));

    const timeline = readSrc(TIMELINE);
    const act = sliceFrom(timeline, 'if (action === "checkoutBed")');
    expect(act.indexOf("canLookupFoodTab")).toBeGreaterThan(-1);
    expect(act.indexOf("canLookupFoodTab")).toBeLessThan(act.indexOf("getPendingFoodTab"));
    expect(act).toContain('foodTabUncheckedMessage("no-phone")');
  });

  it('4. Beds unassigned checkoutGuest: pendingTab>0 modal uses "Checkout anyway"', async () => {
    const beds = readSrc(BEDS);
    const open = sliceFrom(beds, "const openGuestCheckout = async", 900);
    expect(open).toContain('action: "getPendingFoodTab"');
    expect(open).toContain("tabUnchecked");
    expect(beds).toContain("foodTabUncheckedMessage");
    expect(beds).toContain("Checkout anyway");
    expect(beds).toContain("Yes, Checkout");
    expect(beds).toContain('action: "checkoutGuest"');

    const unpaid = await unassignedCheckoutModal("Ada", async () => UNPAID_TAB);
    expect(unpaid.warn).toBe(true);
    expect(unpaid.confirmLabel).toBe("Checkout anyway");
    expect(unpaid.message).toBe(unpaidFoodCheckoutMessage("Ada", 45000, 2));

    const paid = await unassignedCheckoutModal("Ada", async () => PAID_TAB);
    expect(paid.warn).toBe(false);
    expect(paid.confirmLabel).toBe("Yes, Checkout");

    const failed = await unassignedCheckoutModal("Ada", async () => LOOKUP_FAILED);
    expect(failed.warn).toBe(true);
    expect(failed.confirmLabel).toBe("Checkout anyway");
    expect(failed.message).toBe(foodTabUncheckedMessage("lookup-failed"));
  });

  it("5. Timeline checkoutBed unpaid tab: same confirm as beds occupied", async () => {
    const timeline = readSrc(TIMELINE);
    const start = timeline.indexOf('if (action === "checkoutBed")');
    const confirmAt = timeline.indexOf("if (!confirm(msg))", start);
    const lookupAt = timeline.indexOf("getPendingFoodTab", start);
    expect(start).toBeGreaterThan(-1);
    expect(lookupAt).toBeGreaterThan(start);
    expect(lookupAt).toBeLessThan(confirmAt);
    expect(timeline).toContain("unpaidFoodCheckoutMessage");
    expect(sliceFrom(timeline, 'if (action === "checkoutBed")')).toContain(
      'let msg = "Checkout this guest?"',
    );

    const click = await occupiedCheckoutConfirm("Ada", "9876543210", async () => UNPAID_TAB);
    expect(click.warn).toBe(true);
    expect(click.message).toBe(unpaidFoodCheckoutMessage("Ada", 45000, 2));
    expect(click.message).not.toBe(FALLBACK_BEDS_TIMELINE);
  });

  it("6. Booking Check Out Guest: getPendingFoodTab then Unpaid food bill / Check out anyway", async () => {
    const panel = readSrc(PANEL);
    const fn = sliceFrom(panel, "const promptCheckOut = async", 2500);
    expect(fn).toContain("canLookupFoodTab");
    expect(fn).toContain('action: "getPendingFoodTab"');
    expect(fn.indexOf("canLookupFoodTab")).toBeLessThan(fn.indexOf("getPendingFoodTab"));
    expect(fn).toContain('title: "Unpaid food bill"');
    expect(fn).toContain('confirmLabel: "Check out anyway"');
    expect(fn).toContain("unpaidFoodCheckoutMessage");
    expect(fn).toContain('title: "Check Out Guest"');

    const unpaid = await bookingPromptCheckOut("Ada", async () => UNPAID_TAB);
    expect(unpaid.warn).toBe(true);
    expect(unpaid.title).toBe("Unpaid food bill");
    expect(unpaid.confirmLabel).toBe("Check out anyway");
    expect(unpaid.message).toBe(unpaidFoodCheckoutMessage("Ada", 45000, 2));

    const paid = await bookingPromptCheckOut("Ada", async () => PAID_TAB);
    expect(paid.warn).toBe(false);
    expect(paid.title).toBe("Check Out Guest");
    expect(paid.message).toBe("Check out Ada?");

    const failed = await bookingPromptCheckOut("Ada", async () => LOOKUP_FAILED);
    expect(failed.warn).toBe(true);
    expect(failed.confirmLabel).toBe("Check out anyway");
    expect(failed.message).toBe(foodTabUncheckedMessage("lookup-failed"));

    const noPhone = await bookingPromptCheckOut("Ada", async () => {
      throw new Error("must not look up");
    }, "");
    expect(noPhone.warn).toBe(true);
    expect(noPhone.message).toBe(foodTabUncheckedMessage("no-phone"));
    expect(fn).toContain("canLookupFoodTab");
    expect(fn).toContain('foodTabUncheckedMessage("no-phone")');
  });

  it("7. Dashboard today checkout: live tab lookup; unpaid opens modal; pendingTab===0 doCheckout", async () => {
    const dash = readSrc(DASHBOARD);
    const fn = sliceFrom(dash, "const handleCheckoutClick", 1400);
    expect(fn).toContain("getPendingFoodTab");
    expect(fn).toContain("if (pendingTab > 0)");
    expect(fn).toContain("setCheckoutModal");
    expect(fn).toContain("doCheckout(co.bedIdx)");
    expect(fn).toContain('foodTabUncheckedMessage("no-phone")');
    expect(fn).toContain('foodTabUncheckedMessage("lookup-failed")');

    const unpaid = await dashboardCheckoutClick({
      contact: "9876543210",
      lookup: async () => UNPAID_TAB,
    });
    expect(unpaid).toEqual({ openedModal: true, immediateCheckout: false });

    const paid = await dashboardCheckoutClick({
      contact: "9876543210",
      lookup: async () => PAID_TAB,
    });
    expect(paid).toEqual({ openedModal: false, immediateCheckout: true });

    const noPhone = await dashboardCheckoutClick({});
    expect(noPhone.confirm).toBe(foodTabUncheckedMessage("no-phone"));
    expect(noPhone.immediateCheckout).toBe(false);

    const garbage = await dashboardCheckoutClick({ contact: "12" });
    expect(garbage.confirm).toBe(foodTabUncheckedMessage("no-phone"));

    const byIdOnly = await dashboardCheckoutClick({
      checkinId: 9,
      lookup: async () => PAID_TAB,
    });
    expect(byIdOnly).toEqual({ openedModal: false, immediateCheckout: true });

    const failed = await dashboardCheckoutClick({
      contact: "9876543210",
      lookup: async () => LOOKUP_FAILED,
    });
    expect(failed.confirm).toBe(foodTabUncheckedMessage("lookup-failed"));
    expect(failed.openedModal).toBe(false);
  });

  it("8. Lookup throw: beds/timeline warn that the tab could not be checked", async () => {
    const bedsFn = sliceFrom(readSrc(BEDS), "const checkoutBed = async");
    expect(bedsFn).toContain('msg = foodTabUncheckedMessage("lookup-failed")');
    expect(bedsFn.indexOf("catch")).toBeLessThan(bedsFn.indexOf("if (!confirm(msg))"));

    const tl = sliceFrom(readSrc(TIMELINE), 'if (action === "checkoutBed")');
    expect(tl).toContain('msg = foodTabUncheckedMessage("lookup-failed")');
    expect(tl.indexOf("catch")).toBeLessThan(tl.indexOf("if (!confirm(msg))"));

    const boom: TabLookup = async () => {
      throw new Error("d1 down");
    };
    const failedMsg = foodTabUncheckedMessage("lookup-failed");
    const beds = await occupiedCheckoutConfirm("Ada", "9876543210", boom);
    expect(beds.lookedUp).toBe(true);
    expect(beds.warn).toBe(true);
    expect(beds.message).toBe(failedMsg);
    expect(beds.message).not.toBe(FALLBACK_BEDS_TIMELINE);

    const timeline = await occupiedCheckoutConfirm("Ada", "9876543210", boom);
    expect(timeline.message).toBe(failedMsg);
  });

  it("8b. Dashboard Pay does not checkout when markOrderPaid fails", async () => {
    const dash = readSrc(DASHBOARD);
    expect(dash).toContain("if (!payRes.ok)");
    expect(dash).toContain("Could not record food payment");
    expect(dash.indexOf("if (!payRes.ok)")).toBeLessThan(dash.indexOf("await doCheckout(checkoutModal.bedIdx)"));

    await expect(dashboardPayThenCheckout([1, 2], async () => ({ ok: false }))).resolves.toEqual({ checkout: false });
    await expect(dashboardPayThenCheckout([1, 2], async () => ({ ok: true }))).resolves.toEqual({ checkout: true });
    await expect(dashboardPayThenCheckout([], async () => {
      throw new Error("must not pay");
    })).resolves.toEqual({ checkout: true });
  });

  it("8c. Food payment modals await saves and keep failed submissions retryable", () => {
    const source = readSrc("src/components/admin/AdminFoodOrders.tsx");
    expect(source).toContain("const saved = await markGroupPaid");
    expect(source).toContain("if (saved) setPaymentModalGroup(null)");
    expect(source).toContain("const saved = foodAmountPaid(paymentEditOrder) > 0");
    expect(source).toContain("if (saved) setPaymentEditOrder(null)");
    expect(source).toContain('showError("Payment", data.error || "Could not record payment")');
  });

  it("8d. Item editing scrolls the selected order into view and marks it clearly", () => {
    const source = readSrc("src/components/admin/AdminFoodOrders.tsx");
    expect(source).toContain("orderCardRefs.current[editingOrderId]");
    expect(source).toContain('scrollIntoView({ behavior: "smooth", block: "center" })');
    expect(source).toContain('data-order-id={order.id}');
    expect(source).toContain('>Editing</span>');
    expect(source).toContain("ring-2 ring-brand-green/25");
  });

  it("9. Inventory: no other src/components guest-checkout button besides the four UIs", () => {
    const files = walkTsx(join(ROOT, "src/components"));
    const handlerHits: string[] = [];
    const labelHits: string[] = [];
    const IDENT =
      /checkoutBed|checkoutGuest|promptCheckOut|handleCheckoutClick|openGuestCheckout|action:\s*"checkOut"/;

    for (const abs of files) {
      const rel = relative(ROOT, abs);
      const text = readFileSync(abs, "utf8");
      if (IDENT.test(text)) handlerHits.push(rel);
      if (
        /onClick[\s\S]{0,200}(Checkout|Check Out)/.test(text) ||
        /(Checkout|Check Out)[\s\S]{0,80}<\/(button|Button)>/.test(text)
      ) {
        labelHits.push(rel);
      }
    }

    expect(handlerHits.sort()).toEqual([...CHECKOUT_UIS].sort());

    // Button labels that check a guest out (not dates, permissions, food-cart, undo).
    const guestCheckoutLabels = labelHits.filter(
      (rel) =>
        rel === BEDS ||
        rel === TIMELINE ||
        rel === DASHBOARD ||
        rel === PANEL,
    );
    expect(guestCheckoutLabels.sort()).toEqual([...CHECKOUT_UIS].sort());

    const extras = labelHits.filter((rel) => !CHECKOUT_UIS.includes(rel as (typeof CHECKOUT_UIS)[number]));
    for (const rel of extras) {
      const text = readSrc(rel);
      expect(text, rel).not.toMatch(/action:\s*"checkoutBed"/);
      expect(text, rel).not.toMatch(/action:\s*"checkoutGuest"/);
      expect(text, rel).not.toMatch(/action:\s*"checkOut"/);
      expect(text, rel).not.toContain("getPendingFoodTab");
    }
  });
});
