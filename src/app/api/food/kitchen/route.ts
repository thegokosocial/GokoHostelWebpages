import { NextRequest, NextResponse } from "next/server";
import {
  getActiveFoodOrders,
  getFoodOrderItems,
  getFoodOrderItemsBatch,
  getOrderModifications,
  updateFoodOrderStatus,
  toggleMenuItemAvailability,
  getAllMenuItems,
  getMenuItemTagsByIds,
  getActiveMenuCategories,
  addOrderModification,
  updateFoodOrder,
  updateFoodOrderItemQuantity,
  deleteFoodOrderItem,
  getSetting,
  setSetting,
  getUserByUsername,
  addStock,
  decrementStock,
  getMenuItemById,
  getFoodOrderById,
  areAllOrderItemsInventory,
  getMenuItemCategoryExemptions,
} from "@/db/queries";
import { getDb } from "@/db";
import { foodOrderItems, foodOrders, orderModifications } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { authenticateKitchen } from "@/lib/auth";
import { foodTaxPercent } from "@/lib/foodLookup";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, action, ...rest } = body;

    const auth = await authenticateKitchen(password);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { role, displayName: actorName } = auth;

    if (action === "listOrders") {
      const orders = await getActiveFoodOrders();
      const itemsMap = await getFoodOrderItemsBatch(orders.map((o) => o.id));
      const tagIds = [...new Set(
        [...itemsMap.values()].flat().map((i) => i.menuItemId).filter((id): id is number => typeof id === "number"),
      )];
      const menuItemTags = await getMenuItemTagsByIds(tagIds);

      const orderIds = orders.map((o) => o.id);
      const modCountMap = new Map<number, number>();
      if (orderIds.length > 0) {
        const db = getDb();
        const modCounts = await db.select({
          orderId: orderModifications.orderId,
          count: sql<number>`COUNT(*)`,
        }).from(orderModifications).where(inArray(orderModifications.orderId, orderIds)).groupBy(orderModifications.orderId);
        for (const row of modCounts) modCountMap.set(row.orderId, row.count);
      }

      const ordersWithItems = orders.map((order) => {
        const items = itemsMap.get(order.id) || [];
        return {
          ...order,
          hasModifications: (modCountMap.get(order.id) || 0) > 0,
          items: items.map((i) => ({
            id: i.id,
            menuItemId: i.menuItemId,
            itemName: i.itemName,
            itemPrice: i.itemPrice,
            quantity: i.quantity,
            lineTotal: i.lineTotal,
            status: i.status,
            tags: menuItemTags.get(i.menuItemId) || "[]",
          })),
        };
      });

      const isBusy = (await getSetting("food_kitchen_busy")) === "true";

      return NextResponse.json({
        success: true,
        data: { orders: ordersWithItems, isBusy },
      });
    }

    if (action === "updateStatus") {
      const { orderId, status } = rest;
      if (!orderId || !status) {
        return NextResponse.json({ error: "Missing orderId or status" }, { status: 400 });
      }

      const validStatuses = ["pending_approval", "placed", "preparing", "ready", "served", "cancelled"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }

      let finalStatus = status;
      if (status === "placed") {
        const prevOrder = await getFoodOrderById(orderId);
        if (prevOrder?.status === "pending_approval") {
          const allInventory = await areAllOrderItemsInventory(orderId);
          if (allInventory) finalStatus = "ready";
        }
      }

      await updateFoodOrderStatus(orderId, finalStatus);
      return NextResponse.json({ success: true });
    }

    if (action === "updateStatusBulk") {
      const { orderIds, status } = rest;
      if (!Array.isArray(orderIds) || orderIds.length === 0 || !status) {
        return NextResponse.json({ error: "Missing orderIds or status" }, { status: 400 });
      }

      const validTransitions: Record<string, string> = {
        preparing: "placed",
        ready: "preparing",
        served: "ready",
      };
      const expectedStatus = validTransitions[status];
      if (!expectedStatus || orderIds.some((id) => !Number.isInteger(id))) {
        return NextResponse.json({ error: "Invalid bulk status request" }, { status: 400 });
      }

      const uniqueOrderIds = [...new Set(orderIds as number[])];
      let updated = 0;
      for (const orderId of uniqueOrderIds) {
        const order = await getFoodOrderById(orderId);
        if (order?.status !== expectedStatus) continue;
        await updateFoodOrderStatus(orderId, status);
        updated++;
      }

      return NextResponse.json({ success: true, data: { updated, skipped: uniqueOrderIds.length - updated } });
    }

    if (action === "toggleItemAvailability") {
      const { menuItemId, isAvailable } = rest;
      if (menuItemId === undefined || isAvailable === undefined) {
        return NextResponse.json({ error: "Missing menuItemId or isAvailable" }, { status: 400 });
      }

      await toggleMenuItemAvailability(menuItemId, isAvailable ? 1 : 0);
      return NextResponse.json({ success: true });
    }

    if (action === "rejectItem") {
      const { orderId, orderItemId, reason } = rest;
      if (!orderId || !orderItemId) {
        return NextResponse.json({ error: "Missing orderId or orderItemId" }, { status: 400 });
      }

      const db = getDb();

      const allItemsBefore = await getFoodOrderItems(orderId);
      const voidedItem = allItemsBefore.find((i) => i.id === orderItemId);

      await db
        .update(foodOrderItems)
        .set({ status: "voided" })
        .where(eq(foodOrderItems.id, orderItemId));

      if (voidedItem) {
        await addStock(voidedItem.menuItemId, voidedItem.quantity);
      }

      await addOrderModification({
        orderId,
        action: "item_voided",
        itemId: orderItemId,
        oldValue: "active",
        newValue: "voided",
        reason: reason || "",
        modifiedBy: actorName,
      });

      const allItems = await getFoodOrderItems(orderId);
      const activeItems = allItems.filter((i) => i.status !== "voided");

      const grossSubtotal = activeItems.reduce((sum, i) => sum + i.lineTotal, 0);
      const db2 = getDb();
      const [curOrder] = await db2.select({ discount: foodOrders.discount }).from(foodOrders).where(eq(foodOrders.id, orderId)).limit(1);
      const exemptions = await getMenuItemCategoryExemptions(activeItems.map((i) => i.menuItemId));
      const discountableSubtotal = activeItems.filter((i) => !exemptions.get(i.menuItemId)).reduce((sum, i) => sum + i.lineTotal, 0);
      const existingDiscount = Math.min(curOrder?.discount || 0, discountableSubtotal);
      const subtotal = grossSubtotal - existingDiscount;
      const taxRate = foodTaxPercent(await getSetting("food_tax_rate"));
      const tax = Math.round((subtotal * taxRate) / 100);
      const total = subtotal + tax;

      await updateFoodOrder(orderId, { subtotal, tax, total, discount: existingDiscount });

      return NextResponse.json({ success: true, data: { subtotal, tax, total } });
    }

    if (action === "updateItemQuantity") {
      const { orderId, orderItemId, newQuantity } = rest;
      if (!orderId || !orderItemId || newQuantity === undefined) {
        return NextResponse.json({ error: "Missing orderId, orderItemId, or newQuantity" }, { status: 400 });
      }

      const allItems = await getFoodOrderItems(orderId);
      const targetItem = allItems.find((i) => i.id === orderItemId);
      if (!targetItem) {
        return NextResponse.json({ error: "Order item not found" }, { status: 404 });
      }

      const oldQty = targetItem.quantity;
      const qtyDiff = oldQty - (newQuantity > 0 ? newQuantity : 0);

      if (newQuantity <= 0) {
        await deleteFoodOrderItem(orderItemId);
        await addOrderModification({
          orderId,
          action: "item_removed",
          itemId: orderItemId,
          oldValue: String(oldQty),
          newValue: "0",
          reason: "Quantity reduced to zero",
          modifiedBy: actorName,
        });
      } else {
        await updateFoodOrderItemQuantity(orderItemId, newQuantity, targetItem.itemPrice);
        await addOrderModification({
          orderId,
          action: "quantity_changed",
          itemId: orderItemId,
          oldValue: String(oldQty),
          newValue: String(newQuantity),
          reason: "",
          modifiedBy: actorName,
        });
      }

      // Restore or decrement inventory based on quantity change
      if (qtyDiff > 0) {
        await addStock(targetItem.menuItemId, qtyDiff);
      } else if (qtyDiff < 0) {
        await decrementStock(targetItem.menuItemId, Math.abs(qtyDiff));
      }

      const updatedItems = await getFoodOrderItems(orderId);
      const activeItems = updatedItems.filter((i) => i.status !== "voided");
      const grossSub = activeItems.reduce((sum, i) => sum + i.lineTotal, 0);
      const db3 = getDb();
      const [curOrd] = await db3.select({ discount: foodOrders.discount }).from(foodOrders).where(eq(foodOrders.id, orderId)).limit(1);
      const kitchenExemptions = await getMenuItemCategoryExemptions(activeItems.map((i) => i.menuItemId));
      const kitchenDiscountable = activeItems.filter((i) => !kitchenExemptions.get(i.menuItemId)).reduce((sum, i) => sum + i.lineTotal, 0);
      const disc = Math.min(curOrd?.discount || 0, kitchenDiscountable);
      const subtotal = grossSub - disc;
      const taxRate = foodTaxPercent(await getSetting("food_tax_rate"));
      const tax = Math.round((subtotal * taxRate) / 100);
      const total = subtotal + tax;

      await updateFoodOrder(orderId, { subtotal, tax, total, discount: disc });

      return NextResponse.json({ success: true, data: { subtotal, tax, total } });
    }

    if (action === "addItemToOrder") {
      const { orderId, menuItemId, quantity } = rest;
      if (!orderId || !menuItemId || !quantity) {
        return NextResponse.json({ error: "Missing orderId, menuItemId, or quantity" }, { status: 400 });
      }

      const menuItem = await getMenuItemById(menuItemId);
      if (!menuItem) {
        return NextResponse.json({ error: "Menu item not found" }, { status: 404 });
      }
      if (!menuItem.isAvailable) {
        return NextResponse.json({ error: "Menu item is not available" }, { status: 400 });
      }

      const db = getDb();
      const lineTotal = menuItem.price * quantity;

      await db.insert(foodOrderItems).values({
        orderId,
        menuItemId: menuItem.id,
        itemName: menuItem.name,
        itemPrice: menuItem.price,
        quantity,
        lineTotal,
        status: "active",
      });

      await decrementStock(menuItem.id, quantity);

      await addOrderModification({
        orderId,
        action: "item_added",
        itemId: menuItem.id,
        oldValue: "",
        newValue: `${quantity}`,
        reason: `Added ${menuItem.name} x${quantity}`,
        modifiedBy: actorName,
      });

      const updatedItems = await getFoodOrderItems(orderId);
      const activeItems = updatedItems.filter((i) => i.status !== "voided");
      const grossSub2 = activeItems.reduce((sum, i) => sum + i.lineTotal, 0);
      const db4 = getDb();
      const [curOrd2] = await db4.select({ discount: foodOrders.discount }).from(foodOrders).where(eq(foodOrders.id, orderId)).limit(1);
      const addExemptions = await getMenuItemCategoryExemptions(activeItems.map((i) => i.menuItemId));
      const addDiscountable = activeItems.filter((i) => !addExemptions.get(i.menuItemId)).reduce((sum, i) => sum + i.lineTotal, 0);
      const disc2 = Math.min(curOrd2?.discount || 0, addDiscountable);
      const subtotal = grossSub2 - disc2;
      const taxRate = foodTaxPercent(await getSetting("food_tax_rate"));
      const tax = Math.round((subtotal * taxRate) / 100);
      const total = subtotal + tax;

      await updateFoodOrder(orderId, { subtotal, tax, total, discount: disc2 });

      return NextResponse.json({ success: true, data: { subtotal, tax, total, itemName: menuItem.name } });
    }

    if (action === "toggleBusy") {
      const { isBusy } = rest;
      await setSetting("food_kitchen_busy", isBusy ? "true" : "false");
      return NextResponse.json({ success: true });
    }

    if (action === "getMenuItems") {
      const items = await getAllMenuItems();
      const categories = await getActiveMenuCategories();
      const kannadaPrint = (await getSetting("food_kannada_kitchen_print")) !== "false";
      const kannadaDisplay = (await getSetting("food_kannada_kitchen_display")) !== "false";
      const approvalInKitchen = (await getSetting("food_approval_in_kitchen")) === "true";
      return NextResponse.json({
        success: true,
        data: {
          items: items.map((i) => ({
            id: i.id,
            name: i.name,
            nameKannada: i.nameKannada,
            price: i.price,
            isAvailable: i.isAvailable,
            categoryId: i.categoryId,
            tags: i.tags,
          })),
          categories: categories.map((c) => ({
            id: c.id,
            name: c.name,
            icon: c.icon,
          })),
          kannadaPrint,
          kannadaDisplay,
          approvalInKitchen,
        },
      });
    }

    if (action === "getOrderModifications") {
      const { orderId } = rest;
      if (!orderId) {
        return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
      }

      const modifications = await getOrderModifications(orderId);
      const allItems = await getAllMenuItems();
      const itemNameMap = new Map(allItems.map((m) => [m.id, m.name]));

      const db = getDb();
      const orderItemRows = await db.select({ id: foodOrderItems.id, itemName: foodOrderItems.itemName })
        .from(foodOrderItems)
        .where(eq(foodOrderItems.orderId, orderId));
      const orderItemNameMap = new Map(orderItemRows.map((r) => [r.id, r.itemName]));

      const formatted = modifications.map((m) => ({
        action: m.action,
        itemName: m.itemId ? (orderItemNameMap.get(m.itemId) || itemNameMap.get(m.itemId) || `Item #${m.itemId}`) : "",
        oldValue: m.oldValue || "",
        newValue: m.newValue || "",
        modifiedBy: m.modifiedBy,
        createdAt: m.createdAt,
      }));

      return NextResponse.json({ success: true, data: { modifications: formatted } });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Kitchen API error:", error?.message || error);
    const raw = error?.message || "Internal server error";
    const userMessage = raw.includes("Failed query") || raw.includes("D1_ERROR")
      ? "Database temporarily unavailable. Please try again."
      : "Something went wrong. Please try again.";
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
