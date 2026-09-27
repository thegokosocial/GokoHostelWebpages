import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("ActionProgress slow-path surfaces", () => {
  it("keeps the shared overlay mobile-safe (safe-area, touch lock, narrow pill)", () => {
    const provider = read("src/components/ui/ActionProgressProvider.tsx");
    expect(provider).toContain('z-[110]');
    expect(provider).toContain("touch-none");
    expect(provider).toContain("env(safe-area-inset-top)");
    expect(provider).toContain("env(safe-area-inset-bottom)");
    expect(provider).toContain("max-w-[min(20rem,calc(100vw-2rem))]");
  });

  it("wires Admin Food Orders place/save/pay/discount/cancel through runAction", () => {
    const orders = read("src/components/admin/AdminFoodOrders.tsx");
    expect(orders).toContain('import { useActionProgress } from "@/components/ui/ActionProgressProvider"');
    expect(orders).toContain('runAction("Placing order…"');
    expect(orders).toContain('runAction("Saving order changes…"');
    expect(orders).toContain('runAction("Cancelling order…"');
    expect(orders).toContain('runAction("Applying discount…"');
    expect(orders).toContain('runAction("Removing discount…"');
    expect(orders).toContain("Recording payment…");
    expect(orders).toContain("Recording payment for ${");
    expect(orders).toContain("if (saved === undefined) return false");
    expect(orders).toContain("if (paid === undefined) return false");
  });

  it("wires platform receivables allocate/create/fees through runAction", () => {
    const receivables = read("src/components/admin/PlatformReceivables.tsx");
    expect(receivables).toContain("useActionProgress");
    expect(receivables).toContain('runAction("Allocating payout…"');
    expect(receivables).toContain('runAction("Recording payout…"');
    expect(receivables).toContain('runAction("Refreshing fees…"');
    expect(receivables).toContain('runAction("Saving fees…"');
  });

  it("wires inventory bulk/PMS and menu bulk availability through runAction", () => {
    const inventory = read("src/components/admin/InventoryRatePlan.tsx");
    expect(inventory).toContain("useActionProgress");
    expect(inventory).toContain('runAction("Saving availability…"');
    expect(inventory).toContain('runAction("Saving rates…"');
    expect(inventory).toContain('runAction("Saving restrictions…"');
    expect(inventory).toContain('runAction("Saving block…"');
    expect(inventory).toContain('runAction("Removing block…"');
    expect(inventory).toContain('runAction("Syncing with PMS…"');

    const menu = read("src/components/admin/AdminMenuManagement.tsx");
    expect(menu).toContain("useActionProgress");
    expect(menu).toContain('runAction("Updating availability…"');
  });

  it("keeps kitchen and guest cart on the shared overlay", () => {
    const kitchen = read("src/components/kitchen/KitchenDashboard.tsx");
    expect(kitchen).toContain("useActionProgress");
    expect(kitchen).toContain('runAction("Saving order changes…"');
    expect(kitchen).toContain("Updating ${ordersInStage.length} orders…");

    const cart = read("src/components/food/FoodCart.tsx");
    expect(cart).toContain('runAction("Placing order…"');
  });
});
