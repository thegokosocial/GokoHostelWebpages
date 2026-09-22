import { NextRequest, NextResponse } from "next/server";
import {
  getActiveFoodOrders,
  getFoodOrderHistory,
  getFoodOrderById,
  getFoodOrderItems,
  getFoodOrderItemsBatch,
  getOrderModifications,
  updateFoodOrderStatus,
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
  decrementStock,
  restoreStock,
  addStock,
  areAllOrderItemsInventory,
  updateFoodOrderItemQuantity,
  deleteFoodOrderItem,
  getMenuItemCategoryExemptions,
  getAuditRetentionCutoff,
  createFoodBillShareToken,
} from "@/db/queries";
import { parseFoodCheckoutGraceDays, foodTaxPercent } from "@/lib/foodLookup";
import { normalizePhone } from "@/lib/phoneUtils";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed, type ActionPerm } from "@/lib/actionPermissions";
import { getDb } from "@/db";
import { auditLog, foodOrders, foodOrderItems, checkins, guestReceipts, orderModifications } from "@/db/schema";
import { eq, and, sql, desc, inArray, like, or, gte, lte } from "drizzle-orm";
import { createGuestReceipt, latestReceiptAccount, receiptBusinessDate, resolveReceiptAccount } from "@/lib/guestReceipts";
import { syncInsert, syncUpdate } from "@/db/syncMeta";
import { allocateFoodPayment, type FoodPaymentMethod } from "@/lib/foodPaymentAllocation";
import { dispatchPush, notificationFoodBody } from "@/lib/pushNotify";
import { auditDateBounds } from "@/lib/auditRetention";
import { dbRead } from "@/lib/dbRetry";
import { billShareExpiresAt, generateBillShareToken, publicBillShareUrl } from "@/lib/billShare";
import { foodAmountPaid, foodDue, foodPaymentState } from "@/lib/foodPaymentBalance";

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
      listOrders: ["canViewFoodOrders", "canMarkPaid"], getOrderDetails: "canViewFoodOrders",
      getOrderModifications: "canViewFoodOrders", getActiveGuests: "canViewFoodOrders",
      getGuestsWithTabs: ["canViewFoodTabs", "canViewFoodOrders", "canMarkPaid", "canGenerateFoodBills"], getGuestTab: ["canViewFoodTabs", "canViewFoodOrders", "canMarkPaid", "canGenerateFoodBills"],
      getGuestAllOrders: ["canViewFoodTabs", "canViewFoodOrders", "canMarkPaid"], getWalkinOrders: ["canViewFoodOrders", "canMarkPaid"],
      getCombinedBill: ["canGenerateFoodBills", "canViewFoodOrders"], getMenu: ["canViewFoodOrders", "canMarkPaid", "canGenerateFoodBills"],
      createBillShareLink: ["canGenerateFoodBills", "canMarkPaid", "canViewFoodOrders"],
      updateOrderStatus: ["canEditFoodOrders", "canPlaceOrders", "canViewFoodOrders"], placeOrderForGuest: ["canPlaceOrders", "canViewFoodOrders"],
      voidItem: ["canVoidFoodOrders", "canPlaceOrders", "canViewFoodOrders"], updateItemQuantity: ["canEditFoodOrders", "canPlaceOrders", "canViewFoodOrders"],
      setFoodOrderItemPrice: ["canEditFoodOrders", "canPlaceOrders", "canViewFoodOrders"],
      reassignOrder: ["canEditFoodOrders", "canPlaceOrders", "canViewFoodOrders"],
      markOrderPaid: "canMarkPaid", updatePaymentDetails: "canMarkPaid",
      applyDiscount: ["canApplyFoodDiscounts", "canMarkPaid"], removeDiscount: ["canApplyFoodDiscounts", "canMarkPaid"],
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

    function paymentForEditedTotal(order: Awaited<ReturnType<typeof getFoodOrderById>> | null, total: number) {
      if (!order) return {};
      const paid = foodAmountPaid(order);
      if (paid > total) {
        return { overpayment: paid - total, error: `Order total is ₹${(total / 100).toFixed(0)}, but ₹${(paid / 100).toFixed(0)} has already been paid. Choose a correction or refund before saving this reduction.` };
      }
      const state = foodPaymentState(total, paid, order.paymentStatus === "on_tab");
      return {
        amountPaid: state.amountPaid,
        paymentStatus: state.paymentStatus,
        paymentMethod: order.paymentMethod,
        paidBy: state.amountPaid > 0 ? order.paidBy : "",
        cashReceived: state.amountPaid > 0 ? order.cashReceived || 0 : 0,
        changeGiven: state.amountPaid > 0 ? order.changeGiven || 0 : 0,
      };
    }

    switch (action) {
      case "listOrders": {
        const { status, paymentStatus, dateFrom, dateTo, guestType, phone, search, auditHistory, limit: rawLimit, offset: rawOffset, includeItems, includeModifications } = rest;
        const limitNum = Math.min(Number(rawLimit) || 50, 200);
        const requestedOffset = Number(rawOffset);
        const offsetNum = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
        const withItems = includeItems !== false;
        const withModifications = includeModifications !== false;

        const db = getDb();

        if (status === "active" || (!auditHistory && !status && !dateFrom)) {
          const orders = await dbRead(() => getActiveFoodOrders());
          const orderIds = orders.map((o) => o.id);
          const [itemsMap, modCountMap] = await Promise.all([
            withItems ? getFoodOrderItemsBatch(orderIds) : Promise.resolve(new Map()),
            withModifications ? getModCountMap(orderIds) : Promise.resolve(new Map<number, number>()),
          ]);
          const withItemsRows = orders.map((o) => ({
            ...o,
            hasModifications: (modCountMap.get(o.id) || 0) > 0,
            items: withItems ? (itemsMap.get(o.id) || []) : [],
          }));
          return NextResponse.json({ role, orders: withItemsRows });
        }

        const conditions: any[] = [];
        if (status && status !== "all_history") conditions.push(eq(foodOrders.status, status));
        if (paymentStatus) conditions.push(eq(foodOrders.paymentStatus, paymentStatus));
        if (guestType) conditions.push(eq(foodOrders.guestType, guestType));
        if (dateFrom) conditions.push(sql`${foodOrders.createdAt} >= ${dateFrom}`);
        if (dateTo) conditions.push(sql`${foodOrders.createdAt} <= ${dateTo + "T23:59:59"}`);
        if (phone) conditions.push(sql`${foodOrders.guestPhone} LIKE ${"%" + phone + "%"}`);
        if (search) {
          const pattern = `%${String(search).trim()}%`;
          conditions.push(or(
            like(foodOrders.orderNumber, pattern),
            like(foodOrders.guestName, pattern),
            like(foodOrders.guestPhone, pattern),
            like(foodOrders.roomInfo, pattern),
          ));
        }
        if (auditHistory) {
          const bounds = auditDateBounds(await getAuditRetentionCutoff(), dateFrom, dateTo);
          conditions.push(gte(foodOrders.createdAt, bounds.start));
          if (bounds.end) conditions.push(lte(foodOrders.createdAt, bounds.end));
        }

        const orders = await dbRead(() => {
          const query = conditions.length > 0
            ? db.select().from(foodOrders).where(and(...conditions))
            : db.select().from(foodOrders);
          const ordered = query.orderBy(desc(foodOrders.createdAt), desc(foodOrders.id)).limit(limitNum);
          return offsetNum > 0 ? ordered.offset(offsetNum) : ordered;
        });

        const orderIds = orders.map((o) => o.id);
        const [itemsMap, modCountMap] = await Promise.all([
          withItems ? getFoodOrderItemsBatch(orderIds) : Promise.resolve(new Map()),
          withModifications ? getModCountMap(orderIds) : Promise.resolve(new Map<number, number>()),
        ]);
        const withItemsRows = orders.map((o) => ({
          ...o,
          hasModifications: (modCountMap.get(o.id) || 0) > 0,
          items: withItems ? (itemsMap.get(o.id) || []) : [],
        }));
        return NextResponse.json({ role, orders: withItemsRows });
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

        const validatedItems: Array<{ menuItemId: number; itemName: string; itemPrice: number; quantity: number; lineTotal: number; trackInventory: boolean; pricingStatus: string; notes: string }> = [];
        for (const item of items) {
          const menuItem = await getMenuItemById(item.menuItemId);
          if (!menuItem) return NextResponse.json({ error: `Menu item #${item.menuItemId} not found` }, { status: 400 });
          if (menuItem.price <= 0 && menuItem.priceOnRequest !== 1) return NextResponse.json({ error: `"${menuItem.name}" has invalid price` }, { status: 400 });
          const qty = item.quantity || 1;
          if (menuItem.trackInventory && menuItem.stockQuantity < qty) {
            const left = menuItem.stockQuantity;
            return NextResponse.json({ error: left === 0 ? `"${menuItem.name}" is out of stock` : `"${menuItem.name}" only has ${left} left in stock` }, { status: 400 });
          }
          validatedItems.push({
            menuItemId: menuItem.id,
            itemName: menuItem.name,
            itemPrice: menuItem.priceOnRequest === 1 ? 0 : menuItem.price,
            quantity: qty,
            lineTotal: menuItem.priceOnRequest === 1 ? 0 : menuItem.price * qty,
            trackInventory: !!menuItem.trackInventory,
            pricingStatus: menuItem.priceOnRequest === 1 ? "pending" : "fixed",
            notes: typeof item.notes === "string" ? item.notes.trim().slice(0, 500) : "",
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

        await addFoodOrderItems(validatedItems.map((v) => ({ orderId: order.id, menuItemId: v.menuItemId, itemName: v.itemName, itemPrice: v.itemPrice, quantity: v.quantity, lineTotal: v.lineTotal, pricingStatus: v.pricingStatus, notes: v.notes })));

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
          body: notificationFoodBody(guestName, validatedItems, roomInfo, total),
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
        const { orderIds, paymentMethod, cashReceived, changeGiven, onlineAccountId, receiptId } = rest;
        if (!Array.isArray(orderIds) || orderIds.length === 0 || orderIds.some((id: unknown) => !Number.isInteger(id))) {
          return NextResponse.json({ error: "orderIds required" }, { status: 400 });
        }
        if (!paymentMethod || !["cash", "online", "split"].includes(paymentMethod)) return NextResponse.json({ error: "paymentMethod required" }, { status: 400 });
        if (new Set(orderIds).size !== orderIds.length) return NextResponse.json({ error: "Duplicate orderIds are not allowed" }, { status: 400 });

        const method = paymentMethod as FoodPaymentMethod;
        const tenderCash = Number(cashReceived) || 0;
        const tenderChange = Number(changeGiven) || 0;
        const orders = await Promise.all(orderIds.map((id: number) => getFoodOrderById(id)));
        if (orders.some((order) => !order)) return NextResponse.json({ error: "Order not found" }, { status: 404 });
        const existingOrders = orders.filter((order): order is NonNullable<typeof order> => !!order);
        if (existingOrders.some((order) => order.status === "cancelled" || foodDue(order) <= 0)) {
          return NextResponse.json({ error: "Every selected order must have an outstanding balance" }, { status: 409 });
        }
        const itemsByOrder = await getFoodOrderItemsBatch(orderIds);
        if (existingOrders.some((order) => (itemsByOrder.get(order.id) || []).some((item) => item.status !== "voided" && item.pricingStatus === "pending"))) {
          return NextResponse.json({ error: "Set final prices before recording payment" }, { status: 400 });
        }
        const payableOrders = existingOrders.map((order) => ({ id: order.id, total: foodDue(order) }));
        const combinedTotal = payableOrders.reduce((sum, order) => sum + order.total, 0);
        if (method === "cash" && (tenderCash < combinedTotal || tenderChange !== tenderCash - combinedTotal)) {
          return NextResponse.json({ error: "Cash received and change do not match the combined total" }, { status: 400 });
        }
        if (method === "online" && (tenderCash !== 0 || tenderChange !== 0)) {
          return NextResponse.json({ error: "Online payment cannot include cash tender" }, { status: 400 });
        }
        if (method === "split" && (tenderCash <= 0 || tenderCash >= combinedTotal || tenderChange !== 0)) {
          return NextResponse.json({ error: "Split payment must contain both cash and online amounts" }, { status: 400 });
        }
        const allocations = allocateFoodPayment(payableOrders, method, tenderCash, tenderChange);
        const accountId = allocations.some((allocation) => allocation.onlineAmount > 0)
          ? await resolveReceiptAccount("food", onlineAccountId)
          : undefined;
        const db = getDb() as any;
        const assertCurrentOrders = async (client: any) => {
          const currentRows = await client.select().from(foodOrders).where(inArray(foodOrders.id, orderIds));
          if (currentRows.length !== orderIds.length || currentRows.some((order: any) => order.status === "cancelled" || order.paymentStatus === "paid")) {
            throw Object.assign(new Error("A selected order changed before payment was recorded"), { status: 409 });
          }
        };
        const buildPaymentWrites = (client: any) => {
          const writes: any[] = [];
          for (const allocation of allocations) {
            const order = existingOrders.find((candidate) => candidate.id === allocation.orderId)!;
            writes.push(client.update(foodOrders).set(syncUpdate({
              amountPaid: foodPaymentState(order.total, foodAmountPaid(order) + allocation.total, order.paymentStatus === "on_tab").amountPaid,
              paymentStatus: foodPaymentState(order.total, foodAmountPaid(order) + allocation.total, order.paymentStatus === "on_tab").paymentStatus,
              paymentMethod: allocation.paymentMethod,
              paidBy: actorName,
              cashReceived: allocation.cashReceived,
              changeGiven: allocation.changeGiven,
              updatedAt: new Date().toISOString(),
            })).where(eq(foodOrders.id, allocation.orderId)));
            if (allocation.onlineAmount > 0) {
              writes.push(client.insert(guestReceipts).values(syncInsert({
                receiptId: `${receiptId || crypto.randomUUID()}:food:${allocation.orderId}`,
                sourceType: "food_order",
                sourceId: allocation.orderId,
                kind: "food",
                accountId,
                amount: allocation.onlineAmount,
                businessDate: receiptBusinessDate(),
                notes: `Food order ${order.orderNumber}`,
                createdBy: actorName,
                createdAt: new Date().toISOString(),
              })));
            }
          }
          writes.push(client.insert(auditLog).values({
            timestamp: new Date().toISOString(),
            username: actorName,
            action: "food_order_paid",
            target: `orders:${orderIds.join(",")}`,
            details: `Marked paid via ${method}${tenderCash ? `, cash received ₹${(tenderCash / 100).toFixed(0)}` : ""}${tenderChange ? `, change ₹${(tenderChange / 100).toFixed(0)}` : ""}`,
          }));
          return writes;
        };

        // D1 is auto-commit and exposes atomic multi-statement writes through
        // batch(). Keep the explicit transaction fallback for the Pi SQLite runtime.
        if (typeof db.batch === "function") {
          await assertCurrentOrders(db);
          await db.batch(buildPaymentWrites(db));
        } else {
          await db.transaction(async (tx: any) => {
            await assertCurrentOrders(tx);
            for (const write of buildPaymentWrites(tx)) await write;
          });
        }
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
        const currentOrder = await getFoodOrderById(orderId);
        const exemptions = await getMenuItemCategoryExemptions(activeItems.map((i) => i.menuItemId));
        const discountableSubtotal = activeItems.filter((i) => !exemptions.get(i.menuItemId)).reduce((sum, i) => sum + i.lineTotal, 0);
        const existingDiscount = Math.min(currentOrder?.discount || 0, discountableSubtotal);
        const newSubtotal = grossSubtotal - existingDiscount;
        const voidTaxRate = foodTaxPercent(await getSetting("food_tax_rate"));
        const newTax = Math.round((newSubtotal * voidTaxRate) / 100);
        const newTotal = newSubtotal + newTax;
        const paymentUpdate = paymentForEditedTotal(currentOrder, newTotal);
        if (paymentUpdate.error) return NextResponse.json({ error: paymentUpdate.error, requiresPaymentAdjustment: true }, { status: 409 });
        await updateFoodOrder(orderId, { subtotal: newSubtotal, tax: newTax, total: newTotal, discount: existingDiscount, ...paymentUpdate });

        await addAuditEntry({
          username: actorName,
          action: "food_item_voided",
          target: `order:${orderId}/item:${orderItemId}`,
          details: `Cancelled ${item.itemName}${reason ? `: ${reason}` : ""}`,
        });
        return NextResponse.json({ success: true, role, newTotal });
      }

      case "setFoodOrderItemPrice": {
        const { orderId, orderItemId, price, label } = rest;
        const finalPrice = Number(price);
        if (!Number.isInteger(orderId) || !Number.isInteger(orderItemId) || !Number.isInteger(finalPrice) || finalPrice <= 0) {
          return NextResponse.json({ error: "A positive final price is required" }, { status: 400 });
        }
        const order = await getFoodOrderById(orderId);
        const [item] = await getDb().select().from(foodOrderItems).where(and(eq(foodOrderItems.id, orderItemId), eq(foodOrderItems.orderId, orderId))).limit(1);
        if (!order || !item) return NextResponse.json({ error: "Order item not found" }, { status: 404 });
        if (item.pricingStatus !== "pending") return NextResponse.json({ error: "Only pending prices can be finalized" }, { status: 400 });
        if (order.status === "cancelled") return NextResponse.json({ error: "This order cannot be repriced" }, { status: 400 });
        const customLabel = typeof label === "string" ? label.trim().slice(0, 24) : "";
        const oldPrice = item.itemPrice;
        await getDb().update(foodOrderItems).set({
          itemPrice: finalPrice,
          lineTotal: finalPrice * item.quantity,
          pricingStatus: "fixed",
          notes: customLabel,
        }).where(eq(foodOrderItems.id, orderItemId));
        const activeItems = (await getFoodOrderItems(orderId)).filter((i) => i.status !== "voided");
        const grossSubtotal = activeItems.reduce((sum, i) => sum + i.lineTotal, 0);
        const exemptions = await getMenuItemCategoryExemptions(activeItems.map((i) => i.menuItemId));
        const discountableSubtotal = activeItems.filter((i) => !exemptions.get(i.menuItemId)).reduce((sum, i) => sum + i.lineTotal, 0);
        const discount = Math.min(order.discount || 0, discountableSubtotal);
        const subtotal = grossSubtotal - discount;
        const tax = Math.round((subtotal * foodTaxPercent(await getSetting("food_tax_rate"))) / 100);
        const total = subtotal + tax;
        const paymentUpdate = paymentForEditedTotal(order, total);
        if (paymentUpdate.error) return NextResponse.json({ error: paymentUpdate.error, requiresPaymentAdjustment: true }, { status: 409 });
        await updateFoodOrder(orderId, { subtotal, tax, total, discount, ...paymentUpdate });
        await addOrderModification({
          orderId,
          action: "price_finalized",
          itemId: orderItemId,
          oldValue: String(oldPrice),
          newValue: String(finalPrice),
          reason: customLabel ? `Final market price · ${customLabel}` : "Final market price",
          modifiedBy: actorName,
        });
        await addAuditEntry({
          username: actorName,
          action: "food_item_price_finalized",
          target: `order:${orderId}/item:${orderItemId}`,
          details: `Finalized ${item.itemName} at ₹${(finalPrice / 100).toFixed(2)} per unit${customLabel ? ` [${customLabel}]` : ""}`,
        });
        return NextResponse.json({ success: true, role, subtotal, tax, total, notes: customLabel });
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
        const currentOrder = await getFoodOrderById(orderId);
        const projectedItems = allOrderItems
          .filter((item) => item.id !== orderItemId && item.status !== "voided")
          .concat(newQuantity > 0 ? [{ ...targetItem, quantity: newQuantity, lineTotal: newQuantity * targetItem.itemPrice }] : []);
        const projectedGross = projectedItems.reduce((sum, item) => sum + item.lineTotal, 0);
        const projectedExemptions = await getMenuItemCategoryExemptions(projectedItems.map((item) => item.menuItemId));
        const projectedDiscountable = projectedItems.filter((item) => !projectedExemptions.get(item.menuItemId)).reduce((sum, item) => sum + item.lineTotal, 0);
        const projectedDiscount = Math.min(currentOrder?.discount || 0, projectedDiscountable);
        const projectedSubtotal = projectedGross - projectedDiscount;
        const projectedTax = Math.round((projectedSubtotal * foodTaxPercent(await getSetting("food_tax_rate"))) / 100);
        const projectedTotal = projectedSubtotal + projectedTax;
        const paymentUpdate = paymentForEditedTotal(currentOrder, projectedTotal);
        if (paymentUpdate.error) return NextResponse.json({ error: paymentUpdate.error, requiresPaymentAdjustment: true }, { status: 409 });

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
        const curOrd = await getFoodOrderById(orderId);
        const qtyExemptions = await getMenuItemCategoryExemptions(actItems.map((i) => i.menuItemId));
        const qtyDiscountable = actItems.filter((i) => !qtyExemptions.get(i.menuItemId)).reduce((sum, i) => sum + i.lineTotal, 0);
        const disc = Math.min(curOrd?.discount || 0, qtyDiscountable);
        const qtyTaxRate = foodTaxPercent(await getSetting("food_tax_rate"));
        const qtySubtotal = grossSub - disc;
        const qtyTax = Math.round((qtySubtotal * qtyTaxRate) / 100);
        const qtyTotal = qtySubtotal + qtyTax;
        await updateFoodOrder(orderId, { subtotal: qtySubtotal, tax: qtyTax, total: qtyTotal, discount: disc, ...paymentUpdate });

        return NextResponse.json({ success: true, role, data: { subtotal: qtySubtotal, tax: qtyTax, total: qtyTotal } });
      }

      case "applyDiscount": {
        const { orderIds, discountPercent, discountAmount, reason } = rest;
        if (!Array.isArray(orderIds) || orderIds.length === 0 || orderIds.some((id: unknown) => !Number.isInteger(id))) {
          return NextResponse.json({ error: "orderIds required" }, { status: 400 });
        }
        if (new Set(orderIds).size !== orderIds.length) return NextResponse.json({ error: "Duplicate orderIds are not allowed" }, { status: 400 });
        if (!reason) return NextResponse.json({ error: "reason required" }, { status: 400 });
        if (discountPercent == null && discountAmount == null) {
          return NextResponse.json({ error: "discountPercent or discountAmount required" }, { status: 400 });
        }

        const existingOrders = await Promise.all(orderIds.map((orderId: number) => getFoodOrderById(orderId)));
        if (existingOrders.some((order) => !order)) return NextResponse.json({ error: "One or more orders were not found" }, { status: 404 });

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

        const db = getDb();
        await db.transaction(async (tx: any) => {
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
            const current = existingOrders.find((order) => order?.id === od.id);
            const paymentUpdate = paymentForEditedTotal(current || null, newTotal);
            if (paymentUpdate.error) throw Object.assign(new Error(paymentUpdate.error), { status: 409 });
            await tx.update(foodOrders).set(syncUpdate({
              discount: orderDiscount,
              discountReason: reason,
              discountBy: actorName,
              subtotal: newSubtotal,
              tax: newTax,
              total: newTotal,
              amountPaid: paymentUpdate.amountPaid,
              paymentStatus: paymentUpdate.paymentStatus,
              updatedAt: new Date().toISOString(),
            })).where(eq(foodOrders.id, od.id));
            await tx.insert(orderModifications).values(syncInsert({
              orderId: od.id,
              action: "discount",
              oldValue: `₹${(od.grossSubtotal / 100).toFixed(0)}`,
              newValue: `₹${(newTotal / 100).toFixed(0)}`,
              reason: `${reason} (discount ₹${(orderDiscount / 100).toFixed(0)})`,
              modifiedBy: actorName,
              createdAt: new Date().toISOString(),
            }));
          }
          await tx.insert(auditLog).values({
            timestamp: new Date().toISOString(),
            username: actorName,
            action: "food_discount",
            target: `orders:${orderIds.join(",")}`,
            details: `Discount ₹${(totalDiscount / 100).toFixed(0)} on discountable ₹${(discountableTotal / 100).toFixed(0)} of gross ₹${(grossTotal / 100).toFixed(0)}. Reason: ${reason}`,
          });
        });
        return NextResponse.json({ success: true, role });
      }

      case "removeDiscount": {
        const { orderIds: removeOrderIds } = rest;
        if (!removeOrderIds || !Array.isArray(removeOrderIds) || removeOrderIds.length === 0) {
          return NextResponse.json({ error: "orderIds required" }, { status: 400 });
        }

        const rmTaxRate = foodTaxPercent(await getSetting("food_tax_rate"));

        if (!Array.isArray(removeOrderIds) || removeOrderIds.length === 0 || removeOrderIds.some((id: unknown) => !Number.isInteger(id))) {
          return NextResponse.json({ error: "orderIds required" }, { status: 400 });
        }
        if (new Set(removeOrderIds).size !== removeOrderIds.length) return NextResponse.json({ error: "Duplicate orderIds are not allowed" }, { status: 400 });
        const existingOrders = await Promise.all(removeOrderIds.map((orderId: number) => getFoodOrderById(orderId)));
        if (existingOrders.some((order) => !order)) return NextResponse.json({ error: "One or more orders were not found" }, { status: 404 });
        const rmItemsByOrder = await getFoodOrderItemsBatch(removeOrderIds);
        const db = getDb();
        await db.transaction(async (tx: any) => {
          for (const oid of removeOrderIds) {
            const items = rmItemsByOrder.get(oid) || [];
            const activeItems = items.filter((i) => i.status !== "voided");
            const grossSubtotal = activeItems.reduce((sum, i) => sum + i.lineTotal, 0);
            const newTax = Math.round((grossSubtotal * rmTaxRate) / 100);
            const newTotal = grossSubtotal + newTax;
            const current = existingOrders.find((order) => order?.id === oid);
            const paymentUpdate = paymentForEditedTotal(current || null, newTotal);
            if (paymentUpdate.error) throw Object.assign(new Error(paymentUpdate.error), { status: 409 });
            await tx.update(foodOrders).set(syncUpdate({
              discount: 0,
              discountReason: "",
              discountBy: "",
              subtotal: grossSubtotal,
              tax: newTax,
              total: newTotal,
              amountPaid: paymentUpdate.amountPaid,
              paymentStatus: paymentUpdate.paymentStatus,
              updatedAt: new Date().toISOString(),
            })).where(eq(foodOrders.id, oid));
            await tx.insert(orderModifications).values(syncInsert({
              orderId: oid,
              action: "discount",
              oldValue: "discount applied",
              newValue: "discount removed",
              reason: "Discount removed",
              modifiedBy: actorName,
              createdAt: new Date().toISOString(),
            }));
          }
          await tx.insert(auditLog).values({
            timestamp: new Date().toISOString(),
            username: actorName,
            action: "food_discount_removed",
            target: `orders:${removeOrderIds.join(",")}`,
            details: `Discount removed from ${removeOrderIds.length} order(s)`,
          });
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
            inArray(foodOrders.paymentStatus, ["on_tab", "pending", "partial"]),
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
                  inArray(foodOrders.paymentStatus, ["on_tab", "pending", "partial"]),
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

        if (withItems.some((o) => o.items.some((item: any) => item.status !== "voided" && item.pricingStatus === "pending"))) {
          return NextResponse.json({ error: "Set final prices before generating a combined bill" }, { status: 400 });
        }

        const grouped: Record<number, { checkinId: number; guestName: string; guestPhone: string; roomInfo: string; orders: any[]; subtotal: number }> = {};
        for (const o of withItems) {
          const cid = o.checkinId!;
          if (!grouped[cid]) {
            grouped[cid] = {
              checkinId: cid,
              guestName: o.guestName,
              guestPhone: o.guestPhone || "",
              roomInfo: o.roomInfo || "",
              orders: [],
              subtotal: 0,
            };
          }
          if (!grouped[cid].guestPhone && o.guestPhone) grouped[cid].guestPhone = o.guestPhone;
          grouped[cid].orders.push(o);
          grouped[cid].subtotal += o.total;
        }

        const guests = Object.values(grouped);
        const missingPhoneIds = guests.filter((g) => !g.guestPhone).map((g) => g.checkinId);
        if (missingPhoneIds.length > 0) {
          const db = getDb();
          const rows = await db
            .select({ id: checkins.id, contact: checkins.contact })
            .from(checkins)
            .where(inArray(checkins.id, missingPhoneIds));
          const contactById = new Map(rows.map((r) => [r.id, normalizePhone(r.contact || "")]));
          for (const g of guests) {
            if (!g.guestPhone) g.guestPhone = contactById.get(g.checkinId) || "";
          }
        }
        const grandTotal = guests.reduce((sum, g) => sum + g.subtotal, 0);
        return NextResponse.json({ role, guests, grandTotal });
      }

      case "createBillShareLink": {
        const { phone, checkinId } = rest;
        const normalized = normalizePhone(String(phone || ""));
        if (!normalized || normalized.length < 7) {
          return NextResponse.json({ error: "A valid guest phone is required to share the bill" }, { status: 400 });
        }
        const token = generateBillShareToken();
        const expiresAt = billShareExpiresAt(7);
        await createFoodBillShareToken({
          token,
          phone: normalized,
          checkinId: Number.isInteger(checkinId) ? checkinId : null,
          expiresAt,
          createdBy: actorName,
        });
        const origin = req.nextUrl.origin;
        const url = publicBillShareUrl(origin, token);
        await addAuditEntry({
          username: actorName,
          action: "food_bill_share_created",
          target: `phone:${normalized}`,
          details: `Bill share link expires ${expiresAt}`,
        });
        return NextResponse.json({ role, token, url, expiresAt, phone: normalized });
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
              inArray(foodOrders.paymentStatus, ["on_tab", "pending", "partial"]),
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
        if (newPaymentStatus === "paid") {
          const pendingItems = await getFoodOrderItems(orderId);
          if (pendingItems.some((item) => item.status !== "voided" && item.pricingStatus === "pending")) return NextResponse.json({ error: "Set final prices before recording payment" }, { status: 400 });
        }
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

        const nextStatus = newPaymentStatus ?? order.paymentStatus;
        const method = newPaymentMethod ?? order.paymentMethod;
        const cash = Number(newCashReceived ?? order.cashReceived) || 0;
        const currentPaid = foodAmountPaid(order);
        const nextPaid = newPaymentStatus === "paid"
          ? order.total
          : newPaymentStatus !== undefined && newPaymentStatus !== "partial"
            ? 0
            : currentPaid;
        const newPaymentCollection = newPaymentStatus === "paid" && order.paymentStatus !== "paid"
          ? Math.max(0, order.total - currentPaid)
          : 0;
        const replacementAllocation = newPaymentCollection
          || (newPaymentStatus === "paid" || order.paymentStatus === "paid" ? nextPaid : 0);
        const onlineAmount = method === "online"
          ? replacementAllocation
          : method === "split"
            ? Math.max(0, replacementAllocation - cash)
            : 0;
        const oldOnlineAmount = order.paymentMethod === "online"
          ? currentPaid
          : order.paymentMethod === "split"
            ? Math.max(0, currentPaid - (order.cashReceived || 0))
            : 0;
        const oldAccountId = oldOnlineAmount > 0 ? await latestReceiptAccount("food_order", orderId) : null;
        const accountChanged = order.paymentStatus === "paid" && onlineAmount > 0 && onlineAccountId != null && Number(onlineAccountId) !== oldAccountId;
        if (accountChanged) {
          changes.push(`Receiving account changed`);
        }

        if (changes.length === 0) {
          return NextResponse.json({ success: true, role, message: "No changes" });
        }

        const updateData: Record<string, any> = { updatedAt: new Date().toISOString() };
        if (newPaymentStatus !== undefined) {
          const state = foodPaymentState(order.total, nextPaid, newPaymentStatus === "on_tab");
          updateData.amountPaid = state.amountPaid;
          updateData.paymentStatus = state.paymentStatus;
        }
        if (newPaymentMethod !== undefined) updateData.paymentMethod = newPaymentMethod;
        if (newCashReceived !== undefined) updateData.cashReceived = newCashReceived;
        if (newChangeGiven !== undefined) updateData.changeGiven = newChangeGiven;
        if (newPaymentStatus === "paid" && !order.paidBy) updateData.paidBy = actorName;
        if (newPaymentStatus && newPaymentStatus !== "paid" && nextPaid === 0) updateData.paidBy = "";

        const db = getDb();
        await db.update(foodOrders).set(updateData).where(eq(foodOrders.id, orderId));
        const changedAllocation = order.paymentStatus === "paid" && (nextStatus !== "paid" || oldOnlineAmount !== onlineAmount || accountChanged);
        if (changedAllocation && oldOnlineAmount > 0) {
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
    return NextResponse.json({ error: userMessage }, { status: error?.status || (/Receiving bank|Selected receiving bank/.test(raw) ? 400 : 500) });
  }
}
