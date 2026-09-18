"use client";

import type jsPDF from "jspdf";
import {
  accentRgb,
  billPaymentStatusLabel,
  formatGstRateLabel,
  splitGstPaise,
  splitGstRate,
  type BillBranding,
  DEFAULT_BILL_BRANDING,
} from "@/lib/foodBillFormat";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BillOrderItem = {
  itemName: string;
  quantity: number;
  itemPrice: number;
  lineTotal: number;
  status: string;
};

export type BillOrder = {
  orderNumber: string;
  createdAt: string;
  items: BillOrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  discount?: number;
  specialInstructions?: string;
};

export type GuestBillData = {
  guestName: string;
  guestPhone: string;
  roomInfo?: string;
  stayDates?: string;
  orders: BillOrder[];
  grandSubtotal: number;
  grandTax: number;
  grandTotal: number;
  taxRate: number;
  paymentMethod?: string;
  paymentStatus?: string;
  billDate: string;
  discountableSubtotal?: number;
  exemptSubtotal?: number;
  branding?: BillBranding;
  paymentQrDataUrl?: string;
};

export type CombinedBillData = {
  guests: Array<{
    guestName: string;
    guestPhone: string;
    roomInfo?: string;
    orders: BillOrder[];
    guestSubtotal: number;
    guestTax: number;
    guestTotal: number;
  }>;
  grandSubtotal: number;
  grandTax: number;
  grandTotal: number;
  taxRate: number;
  equalSplitAmount?: number;
  paymentMethod?: string;
  billDate: string;
  discountableSubtotal?: number;
  exemptSubtotal?: number;
  branding?: BillBranding;
  paymentQrDataUrl?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatPaise(paise: number): string {
  const rupees = (paise / 100).toFixed(2);
  const [whole, decimal] = rupees.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₹${withCommas}.${decimal}`;
}

function generateBillNumber(): string {
  return `BILL-${Date.now()}`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-");
}

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_LEFT = 18;
const MARGIN_RIGHT = 18;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const FOOTER_ZONE = 28;

const COL_ITEM = MARGIN_LEFT;
const COL_QTY = MARGIN_LEFT + CONTENT_WIDTH * 0.62;
const COL_AMOUNT = PAGE_WIDTH - MARGIN_RIGHT;

function checkPageBreak(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_HEIGHT - FOOTER_ZONE) {
    doc.addPage();
    return 18;
  }
  return y;
}

function drawHorizontalLine(doc: jsPDF, y: number, heavy = false): void {
  doc.setDrawColor(heavy ? 160 : 210, heavy ? 160 : 210, heavy ? 160 : 210);
  doc.setLineWidth(heavy ? 0.5 : 0.3);
  doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y);
}

function resolveBranding(data: { branding?: BillBranding }): BillBranding {
  return data.branding || DEFAULT_BILL_BRANDING;
}

function drawAccentHeader(doc: jsPDF, branding: BillBranding): number {
  const { r, g, b } = accentRgb(branding.accent);
  doc.setFillColor(r, g, b);
  doc.rect(0, 0, PAGE_WIDTH, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(branding.hostelName, PAGE_WIDTH / 2, 12, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(branding.location, PAGE_WIDTH / 2, 20, { align: "center" });
  doc.setTextColor(0, 0, 0);
  return 36;
}

function drawStatusPill(doc: jsPDF, x: number, y: number, label: string, accent: string): void {
  const { r, g, b } = accentRgb(accent);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const w = doc.getTextWidth(label) + 8;
  doc.setFillColor(
    Math.min(255, r + 80),
    Math.min(255, g + 80),
    Math.min(255, b + 80),
  );
  doc.roundedRect(x, y - 4, w, 6, 1.5, 1.5, "F");
  doc.setTextColor(r, g, b);
  doc.text(label, x + 4, y);
  doc.setTextColor(0, 0, 0);
}

function drawTableHeader(doc: jsPDF, y: number): number {
  y = checkPageBreak(doc, y, 10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text("ITEM", COL_ITEM, y);
  doc.text("QTY", COL_QTY, y, { align: "center" });
  doc.text("AMOUNT", COL_AMOUNT, y, { align: "right" });
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  y += 2;
  drawHorizontalLine(doc, y);
  return y + 5;
}

function drawItemRow(doc: jsPDF, y: number, item: BillOrderItem): number {
  const isVoided = item.status === "voided";
  const nameText = isVoided ? `${item.itemName} (CANCELLED)` : item.itemName;
  const showUnit = item.quantity > 1 && !isVoided;
  y = checkPageBreak(doc, y, showUnit ? 10 : 6);

  if (isVoided) doc.setTextColor(160, 160, 160);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const maxNameWidth = COL_QTY - COL_ITEM - 10;
  const lines = doc.splitTextToSize(nameText, maxNameWidth);
  doc.text(lines, COL_ITEM, y);
  doc.text(String(item.quantity), COL_QTY, y, { align: "center" });
  doc.text(formatPaise(item.lineTotal), COL_AMOUNT, y, { align: "right" });

  if (isVoided && lines[0]) {
    const textWidth = doc.getTextWidth(lines[0]);
    doc.setDrawColor(160, 160, 160);
    doc.setLineWidth(0.3);
    doc.line(COL_ITEM, y - 1.2, COL_ITEM + textWidth, y - 1.2);
  }

  let nextY = y + (lines.length > 1 ? lines.length * 4 : 4);
  if (showUnit) {
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`${item.quantity} x ${formatPaise(item.itemPrice)}`, COL_ITEM, nextY + 1);
    doc.setTextColor(0, 0, 0);
    nextY += 4;
  }

  doc.setTextColor(0, 0, 0);
  drawHorizontalLine(doc, nextY + 2);
  return nextY + 6;
}

function drawTotalsBlock(
  doc: jsPDF,
  y: number,
  opts: {
    subtotalLabel: string;
    subtotal: number;
    grandTax: number;
    grandTotal: number;
    taxRate: number;
    discount?: number;
    discountableSubtotal?: number;
    exemptSubtotal?: number;
    paymentMethod?: string;
    equalSplitAmount?: number;
    guestCount?: number;
  },
): number {
  y = checkPageBreak(doc, y, 45);
  drawHorizontalLine(doc, y, true);
  y += 6;

  const totalsX = COL_AMOUNT;
  const labelsX = MARGIN_LEFT;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const hasExemptSplit = (opts.discount || 0) > 0 && opts.exemptSubtotal && opts.exemptSubtotal > 0;
  if (hasExemptSplit) {
    doc.text("Discountable Items", labelsX, y);
    doc.text(formatPaise(opts.discountableSubtotal ?? 0), totalsX, y, { align: "right" });
    y += 5;
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text("Non-discountable Items", labelsX, y);
    doc.text(formatPaise(opts.exemptSubtotal ?? 0), totalsX, y, { align: "right" });
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    y += 5;
  } else {
    doc.text(opts.subtotalLabel, labelsX, y);
    doc.text(formatPaise(opts.subtotal), totalsX, y, { align: "right" });
    y += 5;
  }

  if ((opts.discount || 0) > 0) {
    doc.setTextColor(22, 163, 74);
    doc.text("Discount", labelsX, y);
    doc.text(`-${formatPaise(opts.discount!)}`, totalsX, y, { align: "right" });
    doc.setTextColor(0, 0, 0);
    y += 5;
  }

  if (opts.grandTax > 0) {
    const { cgst, sgst } = splitGstPaise(opts.grandTax);
    const { cgstRate, sgstRate } = splitGstRate(opts.taxRate);
    doc.text(`CGST (${formatGstRateLabel(cgstRate)}%)`, labelsX, y);
    doc.text(formatPaise(cgst), totalsX, y, { align: "right" });
    y += 5;
    doc.text(`SGST (${formatGstRateLabel(sgstRate)}%)`, labelsX, y);
    doc.text(formatPaise(sgst), totalsX, y, { align: "right" });
    y += 5;
  }

  drawHorizontalLine(doc, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Grand Total", labelsX, y);
  doc.text(formatPaise(opts.grandTotal), totalsX, y, { align: "right" });
  y += 7;

  if (opts.equalSplitAmount && opts.guestCount) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      `Split equally: ${formatPaise(opts.equalSplitAmount)} per person (${opts.guestCount} guests)`,
      PAGE_WIDTH / 2,
      y,
      { align: "center" },
    );
    y += 5;
  }

  if (opts.paymentMethod) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Payment Method: ${opts.paymentMethod}`, labelsX, y);
    y += 5;
  }

  return y;
}

function drawPaymentBlock(
  doc: jsPDF,
  y: number,
  branding: BillBranding,
  grandTotal: number,
  paymentQrDataUrl?: string,
  paymentStatus?: string,
): number {
  if (paymentStatus === "paid") return y;
  const showQr = Boolean(paymentQrDataUrl);
  const showUpi = Boolean(branding.upiId);
  if (!showQr && !showUpi) return y;

  y = checkPageBreak(doc, y, showQr ? 70 : 20);
  y += 4;

  if (showQr && paymentQrDataUrl) {
    const size = 42;
    const x = (PAGE_WIDTH - size) / 2;
    try {
      const fmt = paymentQrDataUrl.startsWith("data:image/png")
        ? "PNG"
        : paymentQrDataUrl.startsWith("data:image/webp")
          ? "WEBP"
          : "JPEG";
      doc.addImage(paymentQrDataUrl, fmt, x, y, size, size);
      y += size + 4;
    } catch {
      // soft-fail: continue without image
    }
  }

  const { r, g, b } = accentRgb(branding.accent);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  const payLabel = `Scan to pay `;
  const amount = formatPaise(grandTotal);
  const labelW = doc.getTextWidth(payLabel);
  const amountW = doc.getTextWidth(amount);
  const startX = (PAGE_WIDTH - labelW - amountW) / 2;
  doc.text(payLabel, startX, y);
  doc.setTextColor(r, g, b);
  doc.setFont("helvetica", "bold");
  doc.text(amount, startX + labelW, y);
  doc.setTextColor(0, 0, 0);
  y += 5;

  if (showUpi) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(branding.upiId, PAGE_WIDTH / 2, y, { align: "center" });
    doc.setTextColor(0, 0, 0);
    y += 5;
  }

  return y;
}

function drawFooter(doc: jsPDF, branding: BillBranding): void {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(branding.footer, PAGE_WIDTH / 2, PAGE_HEIGHT - 14, { align: "center" });
    if (pageCount > 1) {
      doc.setFontSize(7);
      doc.text(`Page ${i} of ${pageCount}`, PAGE_WIDTH / 2, PAGE_HEIGHT - 9, { align: "center" });
    }
    doc.setTextColor(0, 0, 0);
  }
}

function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Guest Bill ──────────────────────────────────────────────────────────────

export async function generateGuestBill(data: GuestBillData): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const branding = resolveBranding(data);
  let y = drawAccentHeader(doc, branding);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Goko order", MARGIN_LEFT, y);
  y += 6;

  const primaryOrder = data.orders[0];
  const orderLabel = data.orders.length === 1
    ? `Order #${primaryOrder?.orderNumber || ""}`
    : `${data.orders.length} orders · ${data.guestName}`;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(orderLabel, MARGIN_LEFT, y);
  y += 4;
  doc.text(`Date: ${data.billDate}${primaryOrder ? ` · ${formatOrderDate(primaryOrder.createdAt).split(",").pop()?.trim() || ""}` : ""}`, MARGIN_LEFT, y);
  y += 5;

  const status = billPaymentStatusLabel(data.paymentStatus || (data.paymentMethod ? "paid" : "on_tab"));
  drawStatusPill(doc, MARGIN_LEFT, y, status, branding.accent);
  y += 8;

  if (data.guestName || data.roomInfo) {
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(
      [data.guestName, data.guestPhone, data.roomInfo, data.stayDates].filter(Boolean).join(" · "),
      MARGIN_LEFT,
      y,
    );
    doc.setTextColor(0, 0, 0);
    y += 6;
  }

  for (const order of data.orders) {
    if (data.orders.length > 1) {
      y = checkPageBreak(doc, y, 12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`Order #${order.orderNumber}`, MARGIN_LEFT, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(formatOrderDate(order.createdAt), COL_AMOUNT, y, { align: "right" });
      doc.setTextColor(0, 0, 0);
      y += 5;
    }

    y = drawTableHeader(doc, y);
    for (const item of order.items) {
      y = drawItemRow(doc, y, item);
    }

    if (order.specialInstructions) {
      y = checkPageBreak(doc, y, 6);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(`Note: ${order.specialInstructions}`, MARGIN_LEFT, y);
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "normal");
      y += 5;
    }
  }

  const grandDiscount = data.orders.reduce((sum, o) => sum + (o.discount || 0), 0);
  y = drawTotalsBlock(doc, y, {
    subtotalLabel: "Subtotal",
    subtotal: data.grandSubtotal,
    grandTax: data.grandTax,
    grandTotal: data.grandTotal,
    taxRate: data.taxRate,
    discount: grandDiscount,
    discountableSubtotal: data.discountableSubtotal,
    exemptSubtotal: data.exemptSubtotal,
    paymentMethod: data.paymentMethod,
  });

  y = drawPaymentBlock(doc, y, branding, data.grandTotal, data.paymentQrDataUrl, data.paymentStatus);
  drawFooter(doc, branding);

  const filename = `Goko-Bill-${sanitizeFilename(data.guestName)}-${data.billDate.replace(/[\s,]/g, "-")}.pdf`;
  doc.save(filename);
}

// ─── Combined Bill ───────────────────────────────────────────────────────────

export async function generateCombinedBill(data: CombinedBillData): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const branding = resolveBranding(data);
  let y = drawAccentHeader(doc, branding);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Combined bill", MARGIN_LEFT, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(`Bill #: ${generateBillNumber()}`, MARGIN_LEFT, y);
  y += 4;
  doc.text(`Date: ${data.billDate}`, MARGIN_LEFT, y);
  y += 5;
  drawStatusPill(doc, MARGIN_LEFT, y, "Open tab", branding.accent);
  y += 8;
  doc.setTextColor(0, 0, 0);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Guests", MARGIN_LEFT, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  for (const guest of data.guests) {
    y = checkPageBreak(doc, y, 5);
    const info = guest.roomInfo ? ` (${guest.roomInfo})` : "";
    doc.text(`• ${guest.guestName}${info}`, MARGIN_LEFT + 2, y);
    y += 4;
  }
  y += 3;

  for (const guest of data.guests) {
    y = checkPageBreak(doc, y, 18);
    const { r, g, b } = accentRgb(branding.accent);
    doc.setFillColor(
      Math.min(255, r + 100),
      Math.min(255, g + 100),
      Math.min(255, b + 100),
    );
    doc.rect(MARGIN_LEFT, y - 4, CONTENT_WIDTH, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(guest.guestName, MARGIN_LEFT + 2, y);
    if (guest.roomInfo) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(guest.roomInfo, COL_AMOUNT - 2, y, { align: "right" });
    }
    y += 7;

    for (const order of guest.orders) {
      y = checkPageBreak(doc, y, 12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(`Order #${order.orderNumber}`, MARGIN_LEFT + 2, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(formatOrderDate(order.createdAt), COL_AMOUNT, y, { align: "right" });
      doc.setTextColor(0, 0, 0);
      y += 4;

      y = drawTableHeader(doc, y);
      for (const item of order.items) {
        y = drawItemRow(doc, y, item);
      }
      if (order.specialInstructions) {
        y = checkPageBreak(doc, y, 6);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(`Note: ${order.specialInstructions}`, MARGIN_LEFT + 2, y);
        doc.setTextColor(0, 0, 0);
        y += 5;
      }
    }

    y = checkPageBreak(doc, y, 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`${guest.guestName} Total`, COL_AMOUNT - 45, y, { align: "right" });
    doc.text(formatPaise(guest.guestTotal), COL_AMOUNT, y, { align: "right" });
    y += 4;
    drawHorizontalLine(doc, y);
    y += 6;
  }

  const combinedDiscount = data.guests.reduce(
    (sum, g) => sum + g.orders.reduce((s, o) => s + (o.discount || 0), 0),
    0,
  );
  y = drawTotalsBlock(doc, y, {
    subtotalLabel: "Combined Subtotal",
    subtotal: data.grandSubtotal,
    grandTax: data.grandTax,
    grandTotal: data.grandTotal,
    taxRate: data.taxRate,
    discount: combinedDiscount,
    discountableSubtotal: data.discountableSubtotal,
    exemptSubtotal: data.exemptSubtotal,
    paymentMethod: data.paymentMethod,
    equalSplitAmount: data.equalSplitAmount,
    guestCount: data.guests.length,
  });

  y = drawPaymentBlock(doc, y, branding, data.grandTotal, data.paymentQrDataUrl, "on_tab");
  drawFooter(doc, branding);

  const guestNames = data.guests
    .map((g) => sanitizeFilename(g.guestName))
    .slice(0, 3)
    .join("-");
  const suffix = data.guests.length > 3 ? `-and-${data.guests.length - 3}-more` : "";
  const filename = `Goko-Combined-Bill-${guestNames}${suffix}-${data.billDate.replace(/[\s,]/g, "-")}.pdf`;
  doc.save(filename);
}
