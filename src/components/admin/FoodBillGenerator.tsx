"use client";

import type jsPDF from "jspdf";
import {
  accentRgb,
  billPaymentStatusLabel,
  formatGstRateLabel,
  mergeBillLineItems,
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
  // Left accent rail + name block (not a full-bleed color band)
  const { r, g, b } = accentRgb(branding.accent);
  doc.setFillColor(r, g, b);
  doc.rect(0, 0, 4, 32, "F");
  doc.setFillColor(248, 246, 242);
  doc.rect(4, 0, PAGE_WIDTH - 4, 32, "F");
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(branding.hostelName, MARGIN_LEFT, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(branding.location, MARGIN_LEFT, 22);
  doc.setTextColor(0, 0, 0);
  return 40;
}

function drawStatusPill(doc: jsPDF, x: number, y: number, label: string, accent: string): void {
  const { r, g, b } = accentRgb(accent);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const w = doc.getTextWidth(label) + 10;
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y - 4, w, 6.5, 1, 1, "S");
  doc.setTextColor(r, g, b);
  doc.text(label, x + 5, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
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

// ─── Guest Bill ──────────────────────────────────────────────────────────────

export async function generateGuestBill(data: GuestBillData): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const branding = resolveBranding(data);
  let y = drawAccentHeader(doc, branding);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Food tab", MARGIN_LEFT, y);
  y += 6;

  const orderCount = data.orders.length;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  const metaBits = [
    orderCount > 1 ? `${orderCount} orders` : null,
    data.guestName || null,
  ].filter(Boolean);
  if (metaBits.length) {
    doc.text(metaBits.join(" · "), MARGIN_LEFT, y);
    y += 4;
  }
  doc.text(data.billDate, MARGIN_LEFT, y);
  y += 6;

  const status = billPaymentStatusLabel(data.paymentStatus || (data.paymentMethod ? "paid" : "on_tab"));
  drawStatusPill(doc, MARGIN_LEFT, y, status, branding.accent);
  y += 9;

  const guestLine = [data.guestPhone, data.roomInfo, data.stayDates].filter(Boolean).join(" · ");
  if (guestLine) {
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    doc.text(guestLine, MARGIN_LEFT, y);
    doc.setTextColor(0, 0, 0);
    y += 6;
  }

  const flatItems = mergeBillLineItems(
    data.orders.flatMap((o) => o.items),
  );
  y = drawTableHeader(doc, y);
  for (const item of flatItems) {
    y = drawItemRow(doc, y, item);
  }

  const notes = data.orders
    .map((o) => o.specialInstructions?.trim())
    .filter(Boolean) as string[];
  if (notes.length) {
    y = checkPageBreak(doc, y, 8);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(`Notes: ${notes.join(" · ")}`, MARGIN_LEFT, y);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    y += 5;
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
  doc.setFontSize(13);
  doc.text("Shared food tab", MARGIN_LEFT, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(`${data.guests.length} guests · ${data.billDate}`, MARGIN_LEFT, y);
  y += 6;
  drawStatusPill(doc, MARGIN_LEFT, y, "Open tab", branding.accent);
  y += 9;
  doc.setTextColor(0, 0, 0);

  for (const guest of data.guests) {
    y = checkPageBreak(doc, y, 18);
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_LEFT, y - 2, PAGE_WIDTH - MARGIN_RIGHT, y - 2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(guest.guestName, MARGIN_LEFT, y + 3);
    if (guest.roomInfo) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(guest.roomInfo, COL_AMOUNT, y + 3, { align: "right" });
      doc.setTextColor(0, 0, 0);
    }
    y += 9;

    const flatItems = mergeBillLineItems(guest.orders.flatMap((o) => o.items));
    y = drawTableHeader(doc, y);
    for (const item of flatItems) {
      y = drawItemRow(doc, y, item);
    }

    y = checkPageBreak(doc, y, 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Guest total", COL_AMOUNT - 40, y, { align: "right" });
    doc.text(formatPaise(guest.guestTotal), COL_AMOUNT, y, { align: "right" });
    y += 6;
  }

  const combinedDiscount = data.guests.reduce(
    (sum, g) => sum + g.orders.reduce((s, o) => s + (o.discount || 0), 0),
    0,
  );
  y = drawTotalsBlock(doc, y, {
    subtotalLabel: "Subtotal",
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
