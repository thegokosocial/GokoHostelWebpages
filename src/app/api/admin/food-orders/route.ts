import { NextRequest, NextResponse } from "next/server";
import {
  getActiveFoodOrders,
  getFoodOrderHistory,
  getFoodOrderById,
  getFoodOrderItems,
  getFoodOrderItemsBatch,
  getOrderModifications,
  updateFoodOrderStatus,
  updateFoodOrderPayment,
  updateFoodOrder,
  createFoodOrder,
  addFoodOrderItems,
  addOrderModification,
  getNextOrderNumber,
  getMenuItemById,
  getMenuWithCategories,
  getGuestFoodTab,
  getGuestTabTotal,
  getGuestAllFoodOrders,
  getFoodOrdersByCheckinIds,
  getActiveCheckins,
  getRecentlyCheckedOutGuests,
  getAllBeds,
  addAuditEntry,
  getUserByUsername,
  getSetting,
  getOrdersForCleanup,
  deleteOrderItemsByOrderIds,
  deleteOrdersByIds,
  decrementStock,
  restoreStock,
  addStock,
  areAllOrderItemsInventory,
  updateFoodOrderItemQuantity,
  deleteFoodOrderItem,
  getMenuItemCategoryExemptions,
} from "@/db/queries";
import { parseFoodCheckoutGraceDays, foodTaxPercent } from "@/lib/foodLookup";
import { normalizePhone } from "@/lib/phoneUtils";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed, type ActionPerm } from "@/lib/actionPermissions";
import { getDb } from "@/db";
import { foodOrders, foodOrderItems, checkins, orderModifications } from "@/db/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { createGuestReceipt, latestReceiptAccount, resolveReceiptAccount } from "@/lib/guestReceipts";
import { dispatchPush, notificationFirstName, notificationFoodItems } from "@/lib/pushNotify";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, action, username, ...rest } = body;

    const auth = await authenticateUser(password, username);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, displayName, permissions } = auth;
    const actorName = username || displayName;

    const ACTION_PERMISSIONS: Record<string, ActionPerm> = {
      listOrders: "canViewFoodOrders", getOrderDetails: "canViewFoodOrders",
      getOrderModifications: "canViewFoodOrders", getActiveGuests: "canViewFoodOrders",
      getGuestsWithTabs: "canViewFoodOrders", getGuestTab: "canViewFoodOrders",
      getGuestAllOrders: "canViewFoodOrders", getWalkinOrders: "canViewFoodOrders",
      getCombinedBill: "canViewFoodOrders", getMenu: "canViewFoodOrders",
      updateOrderStatus: ["canPlaceOrders", "canViewFoodOrders"], placeOrderForGuest: ["canPlaceOrders", "canViewFoodOrders"],
      voidItem: ["canPlaceOrders", "canViewFoodOrders"], updateItemQuantity: ["canPlaceOrders", "canViewFoodOrders"],
      reassignOrder: ["canPlaceOrders", "canViewFoodOrders"],
      markOrderPaid: "canMarkPaid", updatePaymentDetails: "canMarkPaid",
      applyDiscount: "canMarkPaid", removeDiscount: "canMarkPaid",
      cleanupOldOrders: "admin_only",
    };

    const gate = actionAllowed(role, permissions, ACTION_PERMISSIONS[action]);
    if (gate === "admin_required") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    if (gate === "forbidden") {
      return NextResponse.json({ error: "You don't have permission to perform this action" }, { status: 403 });
    }

    async function getModCountMap(orderIds?: number[]) {
      if (orderIds && orderIds.length === 0) return new Map<number, number>();
      const db = getDb();
      const q = db.select({
        orderId: orderModifications.orderId,
        count: sql<number>`COUNT(*)`,
      }).from(orderModifications);
      const modCounts = orderIds
        ? await q.where(inArray(orderModifications.orderId, orderIds)).groupBy(orderModifications.orderId)
        : await q.groupBy(orderModifications.orderId);
      return new Map(modCounts.map((r) => [r.orderId, r.count]));
    }

    switch (action) {
      case "listOrders": {
        const { status, dateFrom, dateTo, guestType, phone, limit: rawLimit } = rest;
        const limitNum = Math.min(Number(rawLimit) || 50, 200);

        const db = getDb();
        const modCountMap = await getModCountMap();

        if (status === "active" || (!status && !dateFrom)) {
          const orders = await getActiveFoodOrders();
          const itemsMap = await getFoodOrderItemsBatch(orders.map((o) => o.id));
          const withItems = orders.map((o) => ({
            ...o,
            hasModifications: (modCountMap.get(o.id) || 0) > 0,
            items: itemsMap.get(o.id) || [],
          }));
          return NextResponse.json({ role, orders: withItems });
        }

        const conditions: any[] = [];
        if (status && status !== "all_history") conditions.push(eq(foodOrders.status, status));
        if (guestType) conditions.push(eq(foodOrders.guestType, guestType));
        if (dateFrom) conditions.push(sql`${foodOrders.createdAt} >= ${dateFrom}`);
        if (dateTo) conditions.push(sql`${foodOrders.createdAt} <= ${dateTo + "T23:59:59"}`);
        if (phone) conditions.push(sql`${foodOrders.guestPhone} LIKE ${"%" + phone + "%"}`);

        const orders = conditions.length > 0
          ? await db.select().from(foodOrders).where(and(...conditions)).orderBy(desc(foodOrders.createdAt)).limit(limitNum)
          : await db.select().from(foodOrders).orderBy(desc(foodOrders.createdAt)).limit(limitNum);

        const itemsMap = await getFoodOrderItemsBatch(orders.map((o) => o.id));
        const withItems = orders.map((o) => ({
          ...o,
          hasModifications: (modCountMap.get(o.id) || 0) > 0,
          items: itemsMap.get(o.id) || [],
        }));
        return NextResponse.json({ role, orders: withItems });
      }

      case "getOrderDetails": {
        const { orderId } = rest;
        if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });
        const order = await getFoodOrderById(orderId);
        if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        const items = await getFoodOrderItems(orderId);
        const modifications = await getOrderModifications(orderId);
        return NextResponse.json({ role, order, items, modifications });
      }

      case "updateOrderStatus": {
        const { orderId, status, cancelledReason } = rest;
        if (!orderId || !status) return NextResponse.json({ error: "orderId and status required" }, { status: 400 });
        const validStatuses = ["pending_approval", "placed", "preparing", "ready", "served", "cancelled"];
        if (!validStatuses.includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });

        const prevOrder = await getFoodOrderById(orderId);

        let finalStatus = status;
        if (status === "placed" && prevOrder?.status === "pending_approval") {
          const allInventory = await areAllOrderItemsInventory(orderId);
          if (allInventory) finalStatus = "ready";
        }

        await updateFoodOrderStatus(orderId, finalStatus, cancelledReason);

        if (finalStatus === "cancelled") {
          await restoreStock(orderId);
        }

        if (prevOrder?.status === "pending_approval" && (status === "placed" || status === "cancelled")) {
          await addOrderModification({
            orderId,
            action: status === "placed" ? "order_approved" : "order_rejected",
            oldValue: "pending_approval",
            newValue: finalStatus,
            reason: status === "cancelled" ? (cancelledReason || "Rejected by staff") : "",
            modifiedBy: actorName,
          });
        }

        await addAuditEntry({
          username: actorName,
          action: "food_order_status",
          target: `order:${orderId}`,
          details: `Status → ${finalStatus}${finalStatus !== status ? " (inventory auto-skip)" : ""}${cancelledReason ? ` (${cancelledReason})` : ""}`,
        });
        return NextResponse.json({ success: true, role });
      }

      case "placeOrderForGuest": {
        const { guestType, checkinId, guestName, guestPhone, roomInfo, items, specialInstructions } = rest;
        if (!guestName || !items || !Array.isArray(items) || items.length === 0) {
          return NextResponse.json({ error: "guestName and items required" }, { status: 400 });
        }
        const isTableOrder = roomInfo && /^Table \d+$/i.test(roomInfo);
        if (guestType === "walkin" && !guestPhone?.trim() && !isTableOrder) {
          return NextResponse.json({ error: "Phone number is required for walk-in orders" }, { status: 400 });
        }

        const validatedItems: Array<{ menuItemId: number; itemName: string; itemPrice: number; quantity: number; lineTotal: number; trackInventory: boolean }> = [];
        for (const item of items) {
          const menuItem = await getMenuItemById(item.menuItemId);
          if (!menuItem) return NextResponse.json({ error: `Menu item #${item.menuItemId} not found` }, { status: 400 });
          if (menuItem.price <= 0) return NextResponse.json({ error: `"${menuItem.name}" has invalid price` }, { status: 400 });
          const qty = item.quantity || 1;
          if (menuItem.trackInventory && menuItem.stockQuantity < qty) {
            const left = menuItem.stockQuantity;
            return NextResponse.json({ error: left === 0 ? `"${menuItem.name}" is out of stock` : `"${menuItem.name}" only has ${left} left in stock` }, { status: 400 });
          }
          validatedItems.push({
            menuItemId: menuItem.id,
            itemName: menuItem.name,
            itemPrice: menuItem.price,
            quantity: qty,
            lineTotal: menuItem.price * qty,
            trackInventory: !!menuItem.trackInventory,
          });
        }

        const newItemsSubtotal = validatedItems.reduce((sum, i) => sum + i.lineTotal, 0);
        const taxRate = foodTaxPercent(await getSetting("food_tax_rate"));

        const subtotal = newItemsSubtotal;
        const tax = Math.round((subtotal * taxRate) / 100);
        const total = subtotal + tax;

        let resolvedPhone = normalizePhone(guestPhone || "");
        if (isTableOrder && !resolvedPhone) {
          resolvedPhone = `${Date.now()}`;
        }

        let orderNumber = await getNextOrderNumber();
        let order: any;
        try {
          const result = await createFoodOrder({
            orderNumber,
            guestType: guestType || "walkin",
            checkinId: checkinId || undefined,
            guestName,
            guestPhone: resolvedPhone,
            roomInfo: roomInfo || "",
            specialInstructions: specialInstructions || "",
            subtotal,
            tax,
            total,
            paymentStatus: guestType === "hostel" && checkinId ? "on_tab" : "pending",
            createdBy: actorName,
          });
          order = result[0];
        } catch (err: any) {
          if (err?.message?.includes("UNIQUE") || err?.message?.includes("unique")) {
            orderNumber = await getNextOrderNumber();
            const result = await createFoodOrder({
              orderNumber,
              guestType: guestType || "walkin",
              checkinId: checkinId || undefined,
              guestName,
              guestPhone: resolvedPhone,
              roomInfo: roomInfo || "",
              specialInstructions: specialInstructions || "",
              subtotal,
              tax,
              total,
              paymentStatus: guestType === "hostel" && checkinId ? "on_tab" : "pending",
              createdBy: actorName,
            });
            order = result[0];
          } else {
            throw err;
          }
        }

        await addFoodOrderItems(validatedItems.map((v) => ({ orderId: order.id, menuItemId: v.menuItemId, itemName: v.itemName, itemPrice: v.itemPrice, quantity: v.quantity, lineTotal: v.lineTotal })));

        for (const v of validatedItems) {
          await decrementStock(v.menuItemId, v.quantity);
        }

        if (validatedItems.length > 0 && validatedItems.every((v) => v.trackInventory)) {
          await updateFoodOrderStatus(order.id, "ready");
        }

        await addAuditEntry({
          username: actorName,
          action: "food_order_placed",
          target: `order:${order.id}`,
          details: `Placed for ${guestName} (${guestType}), total ₹${(total / 100).toFixed(0)}`,
        });
        await dispatchPush({
          title: "New Food Order",
          body: `${notificationFoodItems(validatedItems)} · ${roomInfo || notificationFirstName(guestName)} · ₹${(total / 100).toFixed(0)}`,
          url: "/admin?section=foodOrders",
          eventId: `admin-food-order-${order.id}`,
          category: "food",
        });
        return NextResponse.json({ success: true, role, orderId: order.id, orderNumber: order.orderNumber, total });
      }

      case "getGuestTab": {
        const { checkinId } = rest;
        if (!checkinId) return NextResponse.json({ error: "checkinId required" }, { status: 400 });
        const orders = await getGuestFoodTab(checkinId);
        const orderIds = orders.map((o) => o.id);
        const [itemsMap, modCountMap] = await Promise.all([
          getFoodOrderItemsBatch(orderIds),
          getModCountMap(orderIds),
        ]);
        const withItems = orders.map((o) => ({
          ...o,
          items: itemsMap.get(o.id) || [],
          hasModifications: (modCountMap.get(o.id) || 0) > 0,
        }));
        const tabTotal = await getGuestTabTotal(checkinId);
        return NextResponse.json({ role, orders: withItems, tabTotal });
      }

      case "markOrderPaid": {
        const { orderIds, paymentMethod, paidBy, cashReceived, changeGiven, onlineAccountId, receiptId } = rest;
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
          return NextResponse.json({ error: "orderIds required" }, { status: 400 });
        }
        if (!paymentMethod) return NextResponse.json({ error: "paymentMethod required" }, { status: 400 });

        for (const oid of orderIds) {
          const order = await getFoodOrderById(oid);
          if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
          await updateFoodOrderPayment(oid, {
            paymentStatus: "paid",
            paymentMethod,
            paidBy: paidBy || actorName,
            cashReceived: cashReceived ?? 0,
            changeGiven: changeGiven ?? 0,
          });
          const onlineAmount = paymentMethod === "online" ? order.total : paymentMethod === "split" ? Math.max(0, order.total - (Number(cashReceived) || 0)) : 0;
          if (onlineAmount > 0) {
            const accountId = await resolveReceiptAccount("food", onlineAccountId);
            await createGuestReceipt({ receiptId: `${receiptId || crypto.randomUUID()}:food:${oid}`, sourceType: "food_order", sourceId: oid, kind: "food", accountId, amount: onlineAmount, createdBy: paidBy || actorName, notes: `Food order ${order.orderNumber}` });
          }
        }
        await addAuditEntry({
          username: actorName,
          action: "food_order_paid",
          target: `orders:${orderIds.join(",")}`,
          details: `Marked paid via ${paymentMethod}${cashReceived ? `, cash received ₹${(cashReceived / 100).toFixed(0)}` : ""}${changeGiven ? `, change ₹${(changeGiven / 100).toFixed(0)}` : ""}`,
        });
        return NextResponse.json({ success: true, role });
      }

      case "voidItem": {
        const { orderId, orderItemId, reason } = rest;
        if (!orderId || !orderItemId) return NextResponse.json({ error: "orderId and orderItemId required" }, { status: 400 });

        const db = getDb();
        const itemRows = await db.select().from(foodOrderItems).where(eq(foodOrderItems.id, orderItemId)).limit(1);
        const item = itemRows[0];
        if (!item || item.orderId !== orderId) return NextResponse.json({ error: "Item not found" }, { status: 404 });

        await db.update(foodOrderItems).set({ status: "voided" }).where(eq(foodOrderItems.id, orderItemId));
        await addStock(item.menuItemId, item.quantity);
        await addOrderModification({
          orderId,
          action: "void_item",
          itemId: orderItemId,
          oldValue: `${item.itemName} x${item.quantity} = ₹${item.lineTotal}`,
          newValue: "voided",
          reason: reason || "",
          modifiedBy: actorName,
        });

        const activeItems = await db.select().from(foodOrderItems)
          .where(and(eq(foodOrderItems.orderId, orderId), sql`${foodOrderItems.status} != 'voided'`));
        const grossSubtotal = activeItems.reduce((sum, i) => sum + i.lineTotal, 0);
        const [currentOrder] = await db.select({ discount: foodOrders.discount }).from(foodOrders).where(eq(foodOrders.id, orderId)).limit(1);
        const exemptions = await getMenuItemCategoryExemptions(activeItems.map((i) => i.menuItemId));
        const discountableSubtotal = activeItems.filter((i) => !exemptions.get(i.menuItemId)).reduce((sum, i) => sum + i.lineTotal, 0);
        const existingDiscount = Math.min(currentOrder?.discount || 0, discountableSubtotal);
        const newSubtotal = grossSubtotal - existingDiscount;
        const voidTaxRate = foodTaxPercent(await getSetting("food_tax_rate"));
        const newTax = Math.round((newSubtotal * voidTaxRate) / 100);
        const newTotal = newSubtotal + newTax;
        await updateFoodOrder(orderId, { subtotal: newSubtotal, tax: newTax, total: newTotal, discount: existingDiscount });

        await addAuditEntry({
          username: actorName,
          action: "food_item_voided",
          target: `order:${orderId}/item:${orderItemId}`,
          details: `Cancelled ${item.itemName}${reason ? `: ${reason}` : ""}`,
        });
        return NextResponse.json({ success: true, role, newTotal });
      }

      case "updateItemQuantity": {
        const { orderId, orderItemId, newQuantity, reason: qtyReason } = rest;
        if (!orderId || !orderItemId || newQuantity === undefined) {
          return NextResponse.json({ error: "Missing orderId, orderItemId, or newQuantity" }, { status: 400 });
        }
        const db = getDb();

        const allOrderItems = await getFoodOrderItems(orderId);
        const targetItem = allOrderItems.find((i) => i.id === orderItemId);
        if (!targetItem) {
          return NextResponse.json({ error: "Order item not found" }, { status: 404 });
        }

        const oldQty = targetItem.quantity;
        const qtyDiff = oldQty - (newQuantity > 0 ? newQuantity : 0);

        if (newQuantity <= 0) {
          await deleteFoodOrderItem(orderItemId);
          await addOrderModification({ orderId, action: "item_removed", itemId: orderItemId, oldValue: String(oldQty), newValue: "0", reason: qtyReason || "Quantity reduced to zero", modifiedBy: actorName });
        } else {
          await updateFoodOrderItemQuantity(orderItemId, newQuantity, targetItem.itemPrice);
          await addOrderModification({ orderId, action: "quantity_changed", itemId: orderItemId, oldValue: String(oldQty), newValue: String(newQuantity), reason: qtyReason || "", modifiedBy: actorName });
        }

        if (qtyDiff > 0) await addStock(targetItem.menuItemId, qtyDiff);
        else if (qtyDiff < 0) await decrementStock(targetItem.menuItemId, Math.abs(qtyDiff));

        const updItems = await getFoodOrderItems(orderId);
        const actItems = updItems.filter((i) => i.status !== "voided");
        const grossSub = actItems.reduce((sum, i) => sum + i.lineTotal, 0);
        const [curOrd] = await db.select({ discount: foodOrders.discount }).from(foodOrders).where(eq(foodOrders.id, orderId)).limit(1);
        const qtyExemptions = await getMenuItemCategoryExemptions(actItems.map((i) => i.menuItemId));
        const qtyDiscountable = actItems.filter((i) => !qtyExemptions.get(i.menuItemId)).reduce((sum, i) => sum + i.lineTotal, 0);
        const disc = Math.min(curOrd?.discount || 0, qtyDiscountable);
        const qtyTaxRate = foodTaxPercent(await getSetting("food_tax_rate"));
        const qtySubtotal = grossSub - disc;
        const qtyTax = Math.round((qtySubtotal * qtyTaxRate) / 100);
        const qtyTotal = qtySubtotal + qtyTax;
        await updateFoodOrder(orderId, { subtotal: qtySubtotal, tax: qtyTax, total: qtyTotal, discount: disc });

        return NextResponse.json({ success: true, role, data: { subtotal: qtySubtotal, tax: qtyTax, total: qtyTotal } });
      }

      case "applyDiscount": {
        const { orderIds, discountPercent, discountAmount, reason } = rest;
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
          return NextResponse.json({ error: "orderIds required" }, { status: 400 });
        }
        if (!reason) return NextResponse.json({ error: "reason required" }, { status: 400 });
        if (discountPercent == null && discountAmount == null) {
          return NextResponse.json({ error: "discountPercent or discountAmount required" }, { status: 400 });
        }

        const discTaxRate = foodTaxPercent(await getSetting("food_tax_rate"));

        const orderData: { id: number; grossSubtotal: number; discountableSubtotal: number }[] = [];
        const itemsByOrder = await getFoodOrderItemsBatch(orderIds);
        for (const oid of orderIds) {
          const items = itemsByOrder.get(oid) || [];
          const activeItems = items.filter((i) => i.status !== "voided");
          const exemptions = await getMenuItemCategoryExemptions(activeItems.map((i) => i.menuItemId));
          const grossSubtotal = activeItems.reduce((sum, i) => sum + i.lineTotal, 0);
          const discountableSubtotal = activeItems.filter((i) => !exemptions.get(i.menuItemId)).reduce((sum, i) => sum + i.lineTotal, 0);
          orderData.push({ id: oid, grossSubtotal, discountableSubtotal });
        }

        const grossTotal = orderData.reduce((sum, o) => sum + o.grossSubtotal, 0);
        if (grossTotal <= 0) return NextResponse.json({ error: "No billable items" }, { status: 400 });

        const discountableTotal = orderData.reduce((sum, o) => sum + o.discountableSubtotal, 0);

        let totalDiscount: number;
        if (discountPercent != null) {
          const pct = Math.max(0, Math.min(100, Number(discountPercent)));
          totalDiscount = Math.round(discountableTotal * pct / 100);
        } else {
          totalDiscount = Math.max(0, Math.min(discountableTotal, Math.abs(Number(discountAmount))));
        }

        let discountAssigned = 0;
        for (let oi = 0; oi < orderData.length; oi++) {
          const od = orderData[oi];
          const isLast = oi === orderData.length - 1;
          const proportion = discountableTotal > 0 ? od.discountableSubtotal / discountableTotal : 0;
          const orderDiscount = isLast ? (totalDiscount - discountAssigned) : Math.round(totalDiscount * proportion);
          discountAssigned += orderDiscount;
          const newSubtotal = Math.max(0, od.grossSubtotal - orderDiscount);
          const newTax = Math.round((newSubtotal * discTaxRate) / 100);
          const newTotal = newSubtotal + newTax;
          await updateFoodOrder(od.id, {
            discount: orderDiscount,
            discountReason: reason,
            discountBy: actorName,
            subtotal: newSubtotal,
            tax: newTax,
            total: newTotal,
          });
          await addOrderModification({
            orderId: od.id,
            action: "discount",
            oldValue: `₹${(od.grossSubtotal / 100).toFixed(0)}`,
            newValue: `₹${(newTotal / 100).toFixed(0)}`,
            reason: `${reason} (discount ₹${(orderDiscount / 100).toFixed(0)})`,
            modifiedBy: actorName,
          });
        }

        await addAuditEntry({
          username: actorName,
          action: "food_discount",
          target: `orders:${orderIds.join(",")}`,
          details: `Discount ₹${(totalDiscount / 100).toFixed(0)} on discountable ₹${(discountableTotal / 100).toFixed(0)} of gross ₹${(grossTotal / 100).toFixed(0)}. Reason: ${reason}`,
        });
        return NextResponse.json({ success: true, role });
      }

      case "removeDiscount": {
        const { orderIds: removeOrderIds } = rest;
        if (!removeOrderIds || !Array.isArray(removeOrderIds) || removeOrderIds.length === 0) {
          return NextResponse.json({ error: "orderIds required" }, { status: 400 });
        }

        const rmTaxRate = foodTaxPercent(await getSetting("food_tax_rate"));

        const rmItemsByOrder = await getFoodOrderItemsBatch(removeOrderIds);
        for (const oid of removeOrderIds) {
          const items = rmItemsByOrder.get(oid) || [];
          const activeItems = items.filter((i) => i.status !== "voided");
          const grossSubtotal = activeItems.reduce((sum, i) => sum + i.lineTotal, 0);
          const newTax = Math.round((grossSubtotal * rmTaxRate) / 100);
          const newTotal = grossSubtotal + newTax;
          await updateFoodOrder(oid, {
            discount: 0,
            discountReason: "",
            discountBy: "",
            subtotal: grossSubtotal,
            tax: newTax,
            total: newTotal,
          });
          await addOrderModification({
            orderId: oid,
            action: "discount",
            oldValue: "discount applied",
            newValue: "discount removed",
            reason: "Discount removed",
            modifiedBy: actorName,
          });
        }

        await addAuditEntry({
          username: actorName,
          action: "food_discount_removed",
          target: `orders:${removeOrderIds.join(",")}`,
          details: `Discount removed from ${removeOrderIds.length} order(s)`,
        });
        return NextResponse.json({ success: true, role });
      }

      case "reassignOrder": {
        const { orderId, checkinId, guestName, roomInfo } = rest;
        if (!orderId || !checkinId) return NextResponse.json({ error: "orderId and checkinId required" }, { status: 400 });

        await updateFoodOrder(orderId, {
          checkinId,
          guestType: "hostel",
          guestName: guestName || undefined,
          roomInfo: roomInfo || undefined,
          paymentStatus: "on_tab",
        });
        await addAuditEntry({
          username: actorName,
          action: "food_order_reassigned",
          target: `order:${orderId}`,
          details: `Reassigned to checkin:${checkinId} (${guestName || "unknown"})`,
        });
        return NextResponse.json({ success: true, role });
      }

      case "getActiveGuests": {
        const graceDays = parseFoodCheckoutGraceDays(await getSetting("food_checkout_grace_days"));
        const [guests, allBeds, checkedOutGuests] = await Promise.all([
          getActiveCheckins(),
          getAllBeds(),
          graceDays > 0 ? getRecentlyCheckedOutGuests(graceDays) : Promise.resolve([]),
        ]);
        const occupiedBeds = allBeds.filter((b) => b.status === "occupied");

        const activeIds = new Set(guests.map((g) => g.id));
        const guestList = guests.map((g) => {
          const bed = occupiedBeds.find(
            (b) => b.guestName === g.name || b.guestContact === g.contact
          );
          return {
            id: g.id,
            name: g.name,
            contact: g.contact,
            arrivalDate: g.arrivalDate,
            stayingDays: g.stayingDays,
            bedInfo: bed ? `${bed.dormName} - Bed ${bed.bedId}` : "",
            checkedOut: false,
          };
        });

        for (const g of checkedOutGuests) {
          if (activeIds.has(g.id)) continue;
          guestList.push({
            id: g.id,
            name: g.name,
            contact: g.contact,
            arrivalDate: g.arrivalDate,
            stayingDays: g.stayingDays,
            bedInfo: "",
            checkedOut: true,
          });
        }

        return NextResponse.json({ role, guests: guestList });
      }

      case "getGuestsWithTabs": {
        const db = getDb();
        const tabOrders = await db.select({
          checkinId: foodOrders.checkinId,
          tabTotal: sql<number>`SUM(${foodOrders.total})`,
          orderCount: sql<number>`COUNT(*)`,
          latestOrderTime: sql<string>`MAX(${foodOrders.createdAt})`,
        }).from(foodOrders)
          .where(and(
            inArray(foodOrders.paymentStatus, ["on_tab", "pending"]),
            sql`${foodOrders.status} != 'cancelled'`,
          ))
          .groupBy(foodOrders.checkinId);

        const checkinIds = tabOrders.map((r) => r.checkinId).filter((id): id is number => id != null);
        const [allBeds, checkinRows, tabOrderRows] = await Promise.all([
          checkinIds.length > 0 ? getAllBeds() : Promise.resolve([]),
          checkinIds.length > 0
            ? db.select().from(checkins).where(inArray(checkins.id, checkinIds))
            : Promise.resolve([]),
          checkinIds.length > 0
            ? db.select({ id: foodOrders.id, checkinId: foodOrders.checkinId })
                .from(foodOrders)
                .where(and(
                  inArray(foodOrders.checkinId, checkinIds),
                  inArray(foodOrders.paymentStatus, ["on_tab", "pending"]),
                  sql`${foodOrders.status} != 'cancelled'`,
                ))
            : Promise.resolve([]),
        ]);
        const checkinMap = new Map(checkinRows.map((c) => [c.id, c]));

        const allTabOrderIds = tabOrderRows.map((r) => r.id);
        const modCountMap = await getModCountMap(allTabOrderIds);
        const checkinHasMods = new Map<number, boolean>();
        for (const row of tabOrderRows) {
          if (row.checkinId && (modCountMap.get(row.id) || 0) > 0) {
            checkinHasMods.set(row.checkinId, true);
          }
        }

        const guestsWithTabs = [];
        for (const row of tabOrders) {
          if (!row.checkinId) continue;
          const guest = checkinMap.get(row.checkinId);
          if (!guest) continue;

          const bed = allBeds.find(
            (b) => b.status === "occupied" && (b.guestName === guest.name || b.guestContact === guest.contact)
          );

          guestsWithTabs.push({
            checkinId: row.checkinId,
            name: guest.name,
            contact: guest.contact,
            bedInfo: bed ? `${bed.dormName} - Bed ${bed.bedId}` : "",
            tabTotal: row.tabTotal,
            orderCount: row.orderCount,
            latestOrderTime: row.latestOrderTime || "",
            hasModifications: checkinHasMods.get(row.checkinId) || false,
          });
        }
        return NextResponse.json({ role, guests: guestsWithTabs });
      }

      case "getCombinedBill": {
        const { checkinIds } = rest;
        if (!checkinIds || !Array.isArray(checkinIds) || checkinIds.length === 0) {
          return NextResponse.json({ error: "checkinIds required" }, { status: 400 });
        }

        const orders = await getFoodOrdersByCheckinIds(checkinIds);
        const orderIds = orders.map((o) => o.id);
        const [itemsMap, modCountMap] = await Promise.all([
          getFoodOrderItemsBatch(orderIds),
          getModCountMap(orderIds),
        ]);
        const withItems = orders.map((o) => ({
          ...o,
          items: itemsMap.get(o.id) || [],
          hasModifications: (modCountMap.get(o.id) || 0) > 0,
        }));

        const grouped: Record<number, { checkinId: number; guestName: string; roomInfo: string; orders: any[]; subtotal: number }> = {};
        for (const o of withItems) {
          const cid = o.checkinId!;
          if (!grouped[cid]) {
            grouped[cid] = { checkinId: cid, guestName: o.guestName, roomInfo: o.roomInfo || "", orders: [], subtotal: 0 };
          }
          grouped[cid].orders.push(o);
          grouped[cid].subtotal += o.total;
        }

        const guests = Object.values(grouped);
        const grandTotal = guests.reduce((sum, g) => sum + g.subtotal, 0);
        return NextResponse.json({ role, guests, grandTotal });
      }

      case "getMenu": {
        const data = await getMenuWithCategories(true);
        const cafeTablesStr = await getSetting("food_cafe_tables");
        const cafeTableCount = parseInt(cafeTablesStr || "6") || 0;
        const confirmStr = await getSetting("food_confirm_with_guest");
        const confirmWithGuest = confirmStr === "true";
        const histDaysStr = await getSetting("food_payment_history_days");
        const paymentHistoryDays = parseInt(histDaysStr || "7") || 7;
        const kannadaPrint = (await getSetting("food_kannada_kitchen_print")) !== "false";
        const kannadaDisplay = (await getSetting("food_kannada_kitchen_display")) !== "false";
        return NextResponse.json({ role, ...data, cafeTableCount, confirmWithGuest, paymentHistoryDays, kannadaPrint, kannadaDisplay, taxRate: foodTaxPercent(await getSetting("food_tax_rate")) });
      }

      case "getWalkinOrders": {
        const db = getDb();
        const orders = await db
          .select()
          .from(foodOrders)
          .where(
            and(
              eq(foodOrders.guestType, "walkin"),
              inArray(foodOrders.paymentStatus, ["on_tab", "pending"]),
              sql`${foodOrders.status} != 'cancelled'`,
            )
          )
          .orderBy(desc(foodOrders.createdAt));

        const orderIds = orders.map((o) => o.id);
        const [itemsMap, modCountMap] = await Promise.all([
          getFoodOrderItemsBatch(orderIds),
          getModCountMap(orderIds),
        ]);
        const withItems = orders.map((o) => ({
          ...o,
          items: itemsMap.get(o.id) || [],
          hasModifications: (modCountMap.get(o.id) || 0) > 0,
        }));
        return NextResponse.json({ role, orders: withItems });
      }

      case "cleanupOldOrders": {
        const orderIds = await getOrdersForCleanup();
        if (orderIds.length === 0) {
          return NextResponse.json({ success: true, role, ordersCleanedCount: 0, ordersDeletedCount: 0 });
        }

        const ordersDeleted = await deleteOrdersByIds(orderIds);

        await addAuditEntry({
          username: actorName,
          action: "food_cleanup",
          target: `orders:${orderIds.length}`,
          details: `Fully deleted ${ordersDeleted} orders (items + modifications + order rows)`,
        });

        return NextResponse.json({
          success: true,
          role,
          ordersCleanedCount: orderIds.length,
          ordersDeletedCount: ordersDeleted,
        });
      }

      case "getOrderModifications": {
        const { orderId } = rest;
        if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });

        const modifications = await getOrderModifications(orderId);
        const db = getDb();
        const orderItemRows = await db.select({ id: foodOrderItems.id, itemName: foodOrderItems.itemName })
          .from(foodOrderItems)
          .where(eq(foodOrderItems.orderId, orderId));
        const orderItemNameMap = new Map(orderItemRows.map((r) => [r.id, r.itemName]));

        const formatted = modifications.map((m) => ({
          action: m.action,
          itemName: m.itemId ? (orderItemNameMap.get(m.itemId) || `Item #${m.itemId}`) : "",
          oldValue: m.oldValue || "",
          newValue: m.newValue || "",
          modifiedBy: m.modifiedBy,
          createdAt: m.createdAt,
        }));

        return NextResponse.json({ role, modifications: formatted });
      }

      case "getGuestAllOrders": {
        const { checkinId } = rest;
        if (!checkinId) return NextResponse.json({ error: "checkinId required" }, { status: 400 });
        const orders = await getGuestAllFoodOrders(checkinId);
        const orderIds = orders.map((o) => o.id);
        const [itemsMap, modCountMap] = await Promise.all([
          getFoodOrderItemsBatch(orderIds),
          getModCountMap(orderIds),
        ]);
        const withItems = orders.map((o) => ({
          ...o,
          items: itemsMap.get(o.id) || [],
          hasModifications: (modCountMap.get(o.id) || 0) > 0,
        }));
        return NextResponse.json({ role, orders: withItems });
      }

      case "updatePaymentDetails": {
        const { orderId, paymentStatus: newPaymentStatus, paymentMethod: newPaymentMethod, cashReceived: newCashReceived, changeGiven: newChangeGiven, onlineAccountId, receiptId } = rest;
        if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });

        const order = await getFoodOrderById(orderId);
        if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

        const changes: string[] = [];
        const fmt = (paise: number) => `₹${(paise / 100).toFixed(0)}`;

        if (newPaymentStatus !== undefined && newPaymentStatus !== order.paymentStatus) {
          changes.push(`Status: ${order.paymentStatus} → ${newPaymentStatus}`);
        }
        if (newPaymentMethod !== undefined && newPaymentMethod !== order.paymentMethod) {
          changes.push(`Method: ${order.paymentMethod || "none"} → ${newPaymentMethod}`);
        }
        if (newCashReceived !== undefined && newCashReceived !== order.cashReceived) {
          changes.push(`Cash received: ${fmt(order.cashReceived ?? 0)} → ${fmt(newCashReceived)}`);
        }
        if (newChangeGiven !== undefined && newChangeGiven !== order.changeGiven) {
          changes.push(`Change given: ${fmt(order.changeGiven ?? 0)} → ${fmt(newChangeGiven)}`);
        }

        if (changes.length === 0) {
          return NextResponse.json({ success: true, role, message: "No changes" });
        }

        const updateData: Record<string, any> = { updatedAt: new Date().toISOString() };
        if (newPaymentStatus !== undefined) updateData.paymentStatus = newPaymentStatus;
        if (newPaymentMethod !== undefined) updateData.paymentMethod = newPaymentMethod;
        if (newCashReceived !== undefined) updateData.cashReceived = newCashReceived;
        if (newChangeGiven !== undefined) updateData.changeGiven = newChangeGiven;
        if (newPaymentStatus === "paid" && !order.paidBy) updateData.paidBy = actorName;
        if (newPaymentStatus && newPaymentStatus !== "paid" && order.paymentStatus === "paid") updateData.paidBy = "";

        const db = getDb();
        await db.update(foodOrders).set(updateData).where(eq(foodOrders.id, orderId));
        const nextStatus = newPaymentStatus ?? order.paymentStatus;
        const method = newPaymentMethod ?? order.paymentMethod;
        const cash = Number(newCashReceived ?? order.cashReceived) || 0;
        const onlineAmount = method === "online" ? order.total : method === "split" ? Math.max(0, order.total - cash) : 0;
        const oldOnlineAmount = order.paymentStatus === "paid" ? (order.paymentMethod === "online" ? order.total : order.paymentMethod === "split" ? Math.max(0, order.total - (order.cashReceived || 0)) : 0) : 0;
        const changedAllocation = order.paymentStatus === "paid" && (nextStatus !== "paid" || oldOnlineAmount !== onlineAmount || (onlineAmount > 0 && onlineAccountId != null));
        if (changedAllocation && oldOnlineAmount > 0) {
          const oldAccountId = await latestReceiptAccount("food_order", orderId);
          if (oldAccountId) await createGuestReceipt({ receiptId: `${receiptId || crypto.randomUUID()}:reverse`, sourceType: "food_order", sourceId: orderId, kind: "reversal", accountId: oldAccountId, amount: -oldOnlineAmount, createdBy: actorName, notes: `Correction for food order ${order.orderNumber}` });
        }
        if (nextStatus === "paid" && onlineAmount > 0 && (order.paymentStatus !== "paid" || changedAllocation)) {
          const accountId = await resolveReceiptAccount("food", onlineAccountId);
          await createGuestReceipt({ receiptId: receiptId || crypto.randomUUID(), sourceType: "food_order", sourceId: orderId, kind: "food", accountId, amount: onlineAmount, createdBy: actorName, notes: `Food order ${order.orderNumber}` });
        }

        await addAuditEntry({
          username: actorName,
          action: "food_payment_modified",
          target: `order:${orderId}`,
          details: `Order ${order.orderNumber}: ${changes.join(", ")}`,
        });

        return NextResponse.json({ success: true, role });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Admin food orders API error:", error?.message || error);
    const raw = error?.message || "Internal server error";
    const userMessage = raw.includes("Failed query") || raw.includes("D1_ERROR")
      ? "Database temporarily unavailable. Please try again."
      : raw;
    return NextResponse.json({ error: userMessage }, { status: /Receiving bank|Selected receiving bank/.test(raw) ? 400 : 500 });
  }
}
