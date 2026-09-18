"use client";

import {
  DEFAULT_BILL_BRANDING,
  formatGstRateLabel,
  splitGstPaise,
  splitGstRate,
  type BillBranding,
} from "@/lib/foodBillFormat";

const PRINTER_SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
const PRINTER_CHARACTERISTIC = "00002af1-0000-1000-8000-00805f9b34fb";

let cachedDevice: BluetoothDevice | null = null;
let cachedCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

export function isBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export async function connectPrinter(): Promise<boolean> {
  if (!isBluetoothSupported()) {
    throw new Error("Bluetooth is not supported in this browser. Use Chrome or Edge on Android/desktop.");
  }

  try {
    if (cachedDevice?.gatt?.connected && cachedCharacteristic) {
      return true;
    }

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [PRINTER_SERVICE],
    });

    const server = await device.gatt!.connect();

    let characteristic: BluetoothRemoteGATTCharacteristic;
    try {
      const service = await server.getPrimaryService(PRINTER_SERVICE);
      characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC);
    } catch {
      const services = await server.getPrimaryServices();
      let found: BluetoothRemoteGATTCharacteristic | null = null;
      for (const svc of services) {
        try {
          const chars = await svc.getCharacteristics();
          for (const c of chars) {
            if (c.properties.write || c.properties.writeWithoutResponse) {
              found = c;
              break;
            }
          }
          if (found) break;
        } catch {}
      }
      if (!found) throw new Error("Could not find a writable printer characteristic");
      characteristic = found;
    }

    cachedDevice = device;
    cachedCharacteristic = characteristic;

    device.addEventListener("gattserverdisconnected", () => {
      cachedDevice = null;
      cachedCharacteristic = null;
    });

    return true;
  } catch (err: any) {
    if (err.name === "NotFoundError") {
      throw new Error("No printer selected. Please try again and select your printer.");
    }
    throw err;
  }
}

async function sendData(data: Uint8Array): Promise<void> {
  if (!cachedCharacteristic) {
    throw new Error("Printer not connected. Please connect first.");
  }

  const chunkSize = 100;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    if (cachedCharacteristic.properties.writeWithoutResponse) {
      await cachedCharacteristic.writeValueWithoutResponse(chunk);
    } else {
      await cachedCharacteristic.writeValueWithResponse(chunk);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

// --- ESC/POS Command Helpers ---

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function cmd(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

const INIT = cmd(ESC, 0x40);
const BOLD_ON = cmd(ESC, 0x45, 1);
const BOLD_OFF = cmd(ESC, 0x45, 0);
const ALIGN_CENTER = cmd(ESC, 0x61, 1);
const ALIGN_LEFT = cmd(ESC, 0x61, 0);
const ALIGN_RIGHT = cmd(ESC, 0x61, 2);
const DOUBLE_WIDTH_ON = cmd(GS, 0x21, 0x10);
const DOUBLE_WIDTH_OFF = cmd(GS, 0x21, 0x00);
const FEED_CUT = cmd(LF, LF, LF, GS, 0x56, 0x00);

function textBytes(text: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(text);
}

function line(text: string): Uint8Array {
  return concat(textBytes(text), cmd(LF));
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

const LINE_WIDTH = 32;

function separator(char = "-"): string {
  return char.repeat(LINE_WIDTH);
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text.substring(0, width) : text + " ".repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text.substring(0, width) : " ".repeat(width - text.length) + text;
}

function formatPaise(paise: number): string {
  return `Rs.${Math.round(paise / 100)}`;
}

function twoColumn(left: string, right: string): string {
  const rightWidth = right.length;
  const leftWidth = LINE_WIDTH - rightWidth - 1;
  return padRight(left, leftWidth) + " " + right;
}

// --- Public Print Functions ---

export interface BillItem {
  name: string;
  quantity: number;
  price: number;
  lineTotal: number;
  status?: string;
}

export interface BillData {
  billNumber?: string;
  guestName: string;
  guestPhone?: string;
  roomInfo?: string;
  guestType: string;
  items: BillItem[];
  subtotal: number;
  tax: number;
  total: number;
  discount?: number;
  taxRate: number;
  paymentMethod?: string;
  date?: string;
  discountableSubtotal?: number;
  exemptSubtotal?: number;
  branding?: BillBranding;
}

export interface OrderTicketData {
  orderNumber: string;
  guestName: string;
  guestType: string;
  roomInfo?: string;
  items: Array<{ name: string; nameKannada?: string; quantity: number }>;
  specialInstructions?: string;
  createdAt: string;
}

export async function printFoodBill(data: BillData): Promise<void> {
  await connectPrinter();

  const now = data.date || new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const billNo = data.billNumber || `BILL-${Date.now()}`;
  const branding = data.branding || DEFAULT_BILL_BRANDING;

  const parts: Uint8Array[] = [
    INIT,
    ALIGN_CENTER,
    BOLD_ON,
    DOUBLE_WIDTH_ON,
    line(branding.hostelName.length > 16 ? branding.hostelName.substring(0, 16) : branding.hostelName),
    DOUBLE_WIDTH_OFF,
    line(branding.location.length > LINE_WIDTH ? branding.location.substring(0, LINE_WIDTH) : branding.location),
    BOLD_OFF,
    line(separator("=")),
    ALIGN_LEFT,
    line(`Bill: ${billNo}`),
    line(`Date: ${now}`),
    line(`Guest: ${data.guestName}`),
  ];

  if (data.roomInfo) {
    parts.push(line(`Room: ${data.roomInfo}`));
  }

  parts.push(line(separator("-")));
  parts.push(BOLD_ON, line(twoColumn("Item       Qty", "Amount")), BOLD_OFF);
  parts.push(line(separator("-")));

  for (const item of data.items) {
    if (item.status === "voided") continue;
    const itemName = item.name.length > 14 ? item.name.substring(0, 14) : item.name;
    const left = `${itemName} x${item.quantity}`;
    const right = formatPaise(item.lineTotal);
    parts.push(line(twoColumn(left, right)));
  }

  parts.push(line(separator("-")));
  const hasExemptSplit = data.discount && data.discount > 0 && data.exemptSubtotal && data.exemptSubtotal > 0;
  if (hasExemptSplit) {
    parts.push(line(twoColumn("Discountable:", formatPaise(data.discountableSubtotal ?? 0))));
    parts.push(line(twoColumn("Non-discount:", formatPaise(data.exemptSubtotal ?? 0))));
  } else {
    parts.push(line(twoColumn("Subtotal:", formatPaise(data.subtotal))));
  }
  if (data.discount && data.discount > 0) {
    parts.push(line(twoColumn("Discount:", `-${formatPaise(data.discount)}`)));
  }
  if (data.tax > 0) {
    const { cgst, sgst } = splitGstPaise(data.tax);
    const { cgstRate, sgstRate } = splitGstRate(data.taxRate);
    parts.push(line(twoColumn(`CGST (${formatGstRateLabel(cgstRate)}%):`, formatPaise(cgst))));
    parts.push(line(twoColumn(`SGST (${formatGstRateLabel(sgstRate)}%):`, formatPaise(sgst))));
  }
  parts.push(BOLD_ON, DOUBLE_WIDTH_ON);
  parts.push(line(twoColumn("TOTAL:", formatPaise(data.total))));
  parts.push(DOUBLE_WIDTH_OFF, BOLD_OFF);

  if (data.paymentMethod) {
    parts.push(line(separator("-")));
    parts.push(line(`Payment: ${data.paymentMethod}`));
  } else if (branding.upiId) {
    parts.push(line(separator("-")));
    parts.push(ALIGN_CENTER);
    parts.push(line(`Pay: ${formatPaise(data.total)}`));
    parts.push(line(branding.upiId.length > LINE_WIDTH ? branding.upiId.substring(0, LINE_WIDTH) : branding.upiId));
    parts.push(ALIGN_LEFT);
  }

  parts.push(line(separator("=")));
  parts.push(ALIGN_CENTER);
  const footer = branding.footer.length > LINE_WIDTH ? branding.footer.substring(0, LINE_WIDTH) : branding.footer;
  parts.push(line(footer));
  parts.push(FEED_CUT);

  await sendData(concat(...parts));
}

export async function printOrderTicket(data: OrderTicketData): Promise<void> {
  await connectPrinter();

  const time = new Date(data.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const parts: Uint8Array[] = [
    INIT,
    ALIGN_CENTER,
    BOLD_ON,
    DOUBLE_WIDTH_ON,
    line(`#${data.orderNumber}`),
    DOUBLE_WIDTH_OFF,
    BOLD_OFF,
    line(separator("=")),
    ALIGN_LEFT,
    line(`Guest: ${data.guestName}`),
    line(`Time: ${time}`),
  ];
  parts.push(line(separator("-")));
  parts.push(BOLD_ON, line("ITEMS:"), BOLD_OFF);

  for (const item of data.items) {
    parts.push(BOLD_ON);
    parts.push(line(`  ${item.quantity}x ${item.name}`));
    parts.push(BOLD_OFF);
    if (item.nameKannada) {
      parts.push(line(`     ${item.nameKannada}`));
    }
  }

  if (data.specialInstructions) {
    parts.push(line(separator("-")));
    parts.push(BOLD_ON, line("NOTES:"), BOLD_OFF);
    parts.push(line(data.specialInstructions));
  }

  parts.push(line(separator("=")));
  parts.push(FEED_CUT);

  await sendData(concat(...parts));
}

export async function printCombinedBill(
  guests: Array<{ name: string; total: number; discount?: number; items: BillItem[] }>,
  grandTotal: number,
  taxRate: number,
  paymentMethod?: string,
  discountableSubtotal?: number,
  exemptSubtotal?: number,
  branding?: BillBranding,
  grandTax?: number,
): Promise<void> {
  await connectPrinter();

  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const b = branding || DEFAULT_BILL_BRANDING;

  const parts: Uint8Array[] = [
    INIT,
    ALIGN_CENTER,
    BOLD_ON,
    DOUBLE_WIDTH_ON,
    line(b.hostelName.length > 16 ? b.hostelName.substring(0, 16) : b.hostelName),
    DOUBLE_WIDTH_OFF,
    line(b.location.length > LINE_WIDTH ? b.location.substring(0, LINE_WIDTH) : b.location),
    BOLD_OFF,
    line("Combined Bill"),
    line(separator("=")),
    ALIGN_LEFT,
    line(`Date: ${now}`),
    line(`Guests: ${guests.map((g) => g.name).join(", ")}`),
    line(separator("-")),
  ];

  for (const guest of guests) {
    parts.push(BOLD_ON, line(`>> ${guest.name}`), BOLD_OFF);
    for (const item of guest.items) {
      if (item.status === "voided") continue;
      const itemName = item.name.length > 14 ? item.name.substring(0, 14) : item.name;
      parts.push(line(twoColumn(`  ${itemName} x${item.quantity}`, formatPaise(item.lineTotal))));
    }
    parts.push(line(twoColumn(`  Guest total:`, formatPaise(guest.total))));
    parts.push(line(""));
  }

  parts.push(line(separator("-")));
  const combinedDiscount = guests.reduce((sum, g) => sum + (g.discount || 0), 0);
  const hasCombExempt = combinedDiscount > 0 && exemptSubtotal && exemptSubtotal > 0;
  if (hasCombExempt) {
    parts.push(line(twoColumn("Discountable:", formatPaise(discountableSubtotal ?? 0))));
    parts.push(line(twoColumn("Non-discount:", formatPaise(exemptSubtotal ?? 0))));
  }
  if (combinedDiscount > 0) {
    parts.push(line(twoColumn("Discount:", `-${formatPaise(combinedDiscount)}`)));
  }
  if (grandTax && grandTax > 0) {
    const { cgst, sgst } = splitGstPaise(grandTax);
    const { cgstRate, sgstRate } = splitGstRate(taxRate);
    parts.push(line(twoColumn(`CGST (${formatGstRateLabel(cgstRate)}%):`, formatPaise(cgst))));
    parts.push(line(twoColumn(`SGST (${formatGstRateLabel(sgstRate)}%):`, formatPaise(sgst))));
  }
  parts.push(BOLD_ON, DOUBLE_WIDTH_ON);
  parts.push(line(twoColumn("GRAND TOTAL:", formatPaise(grandTotal))));
  parts.push(DOUBLE_WIDTH_OFF, BOLD_OFF);

  const perPerson = Math.ceil(grandTotal / guests.length);
  parts.push(line(twoColumn("Per person:", formatPaise(perPerson))));

  if (paymentMethod) {
    parts.push(line(`Payment: ${paymentMethod}`));
  } else if (b.upiId) {
    parts.push(line(separator("-")));
    parts.push(ALIGN_CENTER);
    parts.push(line(`Pay: ${formatPaise(grandTotal)}`));
    parts.push(line(b.upiId.length > LINE_WIDTH ? b.upiId.substring(0, LINE_WIDTH) : b.upiId));
    parts.push(ALIGN_LEFT);
  }

  parts.push(line(separator("=")));
  parts.push(ALIGN_CENTER);
  const footer = b.footer.length > LINE_WIDTH ? b.footer.substring(0, LINE_WIDTH) : b.footer;
  parts.push(line(footer));
  parts.push(FEED_CUT);

  await sendData(concat(...parts));
}
