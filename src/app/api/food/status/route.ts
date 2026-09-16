import { NextRequest, NextResponse } from "next/server";
import { getFoodOrderByNumber, getFoodOrderItems, getFoodOrderItemsBatch, getActiveCheckins, getGuestAllFoodOrders } from "@/db/queries";
import { normalizePhone, phonesMatch } from "@/lib/phoneUtils";

export async function GET(req: NextRequest) {
  const orderNumber = req.nextUrl.searchParams.get("order") || "";
  const phone = req.nextUrl.searchParams.get("phone") || "";

  if (!phone) {
    return NextResponse.json(
      { found: false, error: "Missing phone" },
      { status: 400 }
    );
  }

  try {
    // If order param is present, return single order status (existing behavior)
    if (orderNumber) {
      const order = await getFoodOrderByNumber(orderNumber);

      if (!order) {
        return NextResponse.json({ found: false });
      }

      if (!phonesMatch(order.guestPhone, phone)) {
        return NextResponse.json({ found: false });
      }

      const items = await getFoodOrderItems(order.id);

      return NextResponse.json({
        found: true,
        order: {
          orderNumber: order.orderNumber,
          status: order.status,
          guestName: order.guestName,
          items: items.map((i) => ({
            menuItemId: i.menuItemId,
            name: i.itemName,
            price: i.itemPrice,
            quantity: i.quantity,
            lineTotal: i.lineTotal,
            pricingStatus: i.pricingStatus,
            notes: i.notes,
          })),
          subtotal: order.subtotal,
          tax: order.tax,
          total: order.total,
          discount: order.discount,
          specialInstructions: order.specialInstructions,
          createdAt: order.createdAt,
        },
      });
    }

    // No order param — return all orders for this phone's active checkin
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return NextResponse.json({ found: false, error: "Invalid phone" }, { status: 400 });
    }

    const activeCheckins = await getActiveCheckins();
    const checkin = activeCheckins.find((c) => phonesMatch(c.contact, normalized));

    if (!checkin) {
      return NextResponse.json({ found: false, orders: [] });
    }

    const allOrders = await getGuestAllFoodOrders(checkin.id);
    const itemsMap = await getFoodOrderItemsBatch(allOrders.map((o) => o.id));
    const ordersWithItems = allOrders.map((o) => {
      const items = itemsMap.get(o.id) || [];
      return {
        orderNumber: o.orderNumber,
        status: o.status,
        items: items.map((i) => ({
          menuItemId: i.menuItemId,
          name: i.itemName,
          quantity: i.quantity,
          price: i.itemPrice,
          lineTotal: i.lineTotal,
          pricingStatus: i.pricingStatus,
          notes: i.notes,
        })),
        total: o.total,
        createdAt: o.createdAt,
      };
    }
    );

    return NextResponse.json({ found: true, orders: ordersWithItems });
  } catch (error: any) {
    console.error("Order status error:", error?.message || error);
    return NextResponse.json({ error: "Failed to fetch order status" }, { status: 500 });
  }
}
