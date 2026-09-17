import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getDb } from "@/db";
import { expenses, dailyIncome, vendors, accounts } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { addSystemLog, getSetting } from "@/db/queries";
import { parseExpenseCategories, parseIncomeCategories } from "@/lib/accountCategories";

const MAX_ROWS = 500;

const EXPENSE_COLUMNS = [
  { header: "date", description: "Date (required) YYYY-MM-DD or DD/MM/YYYY" },
  { header: "amount", description: "Amount in ₹ (required) e.g. 500" },
  { header: "category", description: "Salary / Rent / Utilities / Groceries / Capital / Maintenance / Supplies / Transport / Miscellaneous / Others (required)" },
  { header: "type", description: "stay_expense or food_expense (default: stay_expense)" },
  { header: "payment_method", description: "cash or online (default: cash)" },
  { header: "vendor", description: "Vendor name (optional, must match existing vendor)" },
  { header: "account_name", description: "Account name or nickname (optional, for online payments)" },
  { header: "notes", description: "Purpose / notes (optional)" },
];

const INCOME_COLUMNS = [
  { header: "date", description: "Date (required) YYYY-MM-DD or DD/MM/YYYY" },
  { header: "amount", description: "Amount in ₹ (required) e.g. 1000" },
  { header: "source", description: "stay / food / refund / other (default: stay)" },
  { header: "source_detail", description: "Required when source is other" },
  { header: "type", description: "cash or online (default: cash)" },
  { header: "account_name", description: "Account name or nickname (optional, for online payments)" },
  { header: "description", description: "Description / notes (optional)" },
];

const VALID_MAIN_CATEGORIES = ["stay_expense", "food_expense"];
const VALID_PAYMENT_METHODS = ["cash", "online"];

function cellToString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "yes" : "no";
  return String(val).trim();
}

function parseDate(val: unknown): string {
  if (val === null || val === undefined || val === "") return "";

  if (typeof val === "number") {
    const jsDate = XLSX.SSF.parse_date_code(val);
    if (jsDate) {
      const y = String(jsDate.y).padStart(4, "0");
      const m = String(jsDate.m).padStart(2, "0");
      const d = String(jsDate.d).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return "";
  }

  const str = String(val).trim();
  if (!str) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const dmyMatch = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return str;
}

function deriveCreatedMonth(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    const now = new Date();
    const months = [
      "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
      "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
    ];
    return `${months[now.getUTCMonth()]}-${now.getUTCFullYear()}`;
  }
  const months = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
  ];
  return `${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function generateTemplate(columns: { header: string; description: string }[], sheetName: string): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const headers = columns.map((c) => c.header);
  const descriptions = columns.map((c) => c.description);
  const ws = XLSX.utils.aoa_to_sheet([headers, descriptions]);
  ws["!cols"] = columns.map((c) => ({
    wch: Math.max(c.header.length, c.description.length) + 2,
  }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

import { authenticateSimple } from "@/lib/auth";

async function importExpenses(
  rows: Record<string, unknown>[],
  actorName: string,
): Promise<{ total: number; inserted: number; skipped: number; failed: { row: number; reason: string }[] }> {
  const db = getDb();
  const results = { total: rows.length, inserted: 0, skipped: 0, failed: [] as { row: number; reason: string }[] };
  const validCategories = parseExpenseCategories(await getSetting("expense_categories"));

  const allVendors = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.isActive, 1));
  const vendorMap = new Map(allVendors.map((v) => [v.name.toLowerCase(), v.id]));

  const allAccounts = await db.select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname }).from(accounts).where(eq(accounts.isActive, 1));
  const accountMap = new Map<string, number>();
  for (const a of allAccounts) {
    accountMap.set(a.name.toLowerCase(), a.id);
    if (a.nickname) accountMap.set(a.nickname.toLowerCase(), a.id);
  }

  const BATCH_SIZE = 50;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (let j = 0; j < batch.length; j++) {
      const rowIndex = i + j + 3; // +1 header, +1 description, +1 for 1-indexed Excel
      const row = batch[j];

      try {
        const dateStr = parseDate(row.date);
        const amountRaw = cellToString(row.amount);
        const category = cellToString(row.category);

        if (!dateStr) {
          results.failed.push({ row: rowIndex, reason: "Missing or invalid date" });
          continue;
        }

        const dateCheck = new Date(dateStr);
        if (isNaN(dateCheck.getTime())) {
          results.failed.push({ row: rowIndex, reason: `Invalid date: ${cellToString(row.date)}` });
          continue;
        }

        const amountNum = parseFloat(amountRaw);
        if (!amountNum || amountNum <= 0) {
          results.failed.push({ row: rowIndex, reason: "Missing or invalid amount" });
          continue;
        }

        if (!category) {
          results.failed.push({ row: rowIndex, reason: "Missing category" });
          continue;
        }

        const categoryMatch = validCategories.find((c) => c.toLowerCase() === category.toLowerCase());
        if (!categoryMatch) {
          results.failed.push({ row: rowIndex, reason: `Invalid category: "${category}". Use: ${validCategories.join(", ")}` });
          continue;
        }

        const mainCategory = cellToString(row.type).toLowerCase() || "stay_expense";
        if (!VALID_MAIN_CATEGORIES.includes(mainCategory)) {
          results.failed.push({ row: rowIndex, reason: `Invalid type: "${mainCategory}". Use: stay_expense or food_expense` });
          continue;
        }

        const paymentMethod = cellToString(row.payment_method).toLowerCase() || "cash";
        if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
          results.failed.push({ row: rowIndex, reason: `Invalid payment_method: "${paymentMethod}". Use: cash or online` });
          continue;
        }

        const vendorName = cellToString(row.vendor);
        let vendorId: number | null = null;
        if (vendorName) {
          const foundId = vendorMap.get(vendorName.toLowerCase());
          if (foundId === undefined) {
            results.failed.push({ row: rowIndex, reason: `Vendor not found: "${vendorName}". Create it first in Account Settings.` });
            continue;
          }
          vendorId = foundId;
        }

        const accountName = cellToString(row.account_name);
        let accountId: number | null = null;
        if (accountName) {
          const foundId = accountMap.get(accountName.toLowerCase());
          if (foundId === undefined) {
            results.failed.push({ row: rowIndex, reason: `Account not found: "${accountName}". Create it first in Account Settings.` });
            continue;
          }
          accountId = foundId;
        }

        const notes = cellToString(row.notes);
        const amountPaise = Math.round(amountNum * 100);
        const createdMonth = deriveCreatedMonth(dateStr);

        // Duplicate check: same date + amount + category + notes
        const existing = await db
          .select({ id: expenses.id })
          .from(expenses)
          .where(
            and(
              sql`${expenses.createdAt} >= ${dateStr}`,
              sql`${expenses.createdAt} <= ${dateStr + "T23:59:59.999Z"}`,
              eq(expenses.amount, amountPaise),
              sql`LOWER(${expenses.category}) = LOWER(${categoryMatch})`,
              sql`LOWER(${expenses.purpose}) = LOWER(${notes || categoryMatch})`
            )
          )
          .limit(1);

        if (existing.length > 0) {
          results.skipped++;
          continue;
        }

        const createdAt = `${dateStr}T12:00:00.000Z`;
        await db.insert(expenses).values({
          amount: amountPaise,
          category: categoryMatch,
          customCategory: "",
          purpose: notes || categoryMatch,
          billImageLink: "",
          vendorId,
          accountId,
          paymentMethod,
          mainCategory,
          subCategory: categoryMatch,
          createdBy: actorName,
          updatedBy: "",
          createdAt,
          updatedAt: createdAt,
          expenseDate: dateStr,
          createdMonth,
        });
        results.inserted++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Database insert failed";
        results.failed.push({ row: rowIndex, reason: message });
      }
    }
  }

  return results;
}

async function importIncome(
  rows: Record<string, unknown>[],
  actorName: string,
): Promise<{ total: number; inserted: number; skipped: number; failed: { row: number; reason: string }[] }> {
  const db = getDb();
  const results = { total: rows.length, inserted: 0, skipped: 0, failed: [] as { row: number; reason: string }[] };
  const incomeCategories = parseIncomeCategories(await getSetting("income_categories"));

  const allAccounts = await db.select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname }).from(accounts).where(eq(accounts.isActive, 1));
  const accountMap = new Map<string, number>();
  for (const a of allAccounts) {
    accountMap.set(a.name.toLowerCase(), a.id);
    if (a.nickname) accountMap.set(a.nickname.toLowerCase(), a.id);
  }

  const BATCH_SIZE = 50;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (let j = 0; j < batch.length; j++) {
      const rowIndex = i + j + 3;
      const row = batch[j];

      try {
        const dateStr = parseDate(row.date);
        const amountRaw = cellToString(row.amount);

        if (!dateStr) {
          results.failed.push({ row: rowIndex, reason: "Missing or invalid date" });
          continue;
        }

        const dateCheck = new Date(dateStr);
        if (isNaN(dateCheck.getTime())) {
          results.failed.push({ row: rowIndex, reason: `Invalid date: ${cellToString(row.date)}` });
          continue;
        }

        const amountNum = parseFloat(amountRaw);
        if (!amountNum || amountNum <= 0) {
          results.failed.push({ row: rowIndex, reason: "Missing or invalid amount" });
          continue;
        }

        const sourceInput = cellToString(row.source) || "stay";
        const source = incomeCategories.find((item) => item.id.toLowerCase() === sourceInput.toLowerCase() || item.name.toLowerCase() === sourceInput.toLowerCase())?.id;
        if (!source) {
          results.failed.push({ row: rowIndex, reason: `Invalid source: "${sourceInput}". Use: ${incomeCategories.map((item) => item.name).join(", ")}` });
          continue;
        }
        const sourceDetail = cellToString(row.source_detail);
        if (source === "other" && !sourceDetail) {
          results.failed.push({ row: rowIndex, reason: "source_detail is required when source is other" });
          continue;
        }
        if (source !== "other" && sourceDetail) {
          results.failed.push({ row: rowIndex, reason: "source_detail is only valid when source is other" });
          continue;
        }
        if (sourceDetail.length > 100) {
          results.failed.push({ row: rowIndex, reason: "source_detail must be 100 characters or fewer" });
          continue;
        }

        const type = cellToString(row.type).toLowerCase() || "cash";
        if (!VALID_PAYMENT_METHODS.includes(type)) {
          results.failed.push({ row: rowIndex, reason: `Invalid type: "${type}". Use: cash or online` });
          continue;
        }

        const accountName = cellToString(row.account_name);
        let accountId: number | null = null;
        if (accountName) {
          const foundId = accountMap.get(accountName.toLowerCase());
          if (foundId === undefined) {
            results.failed.push({ row: rowIndex, reason: `Account not found: "${accountName}". Create it first in Account Settings.` });
            continue;
          }
          accountId = foundId;
        }
        if (type === "cash" && accountId !== null) {
          results.failed.push({ row: rowIndex, reason: "Cash income must not specify an account_name" });
          continue;
        }
        if (type === "online" && accountId === null) {
          results.failed.push({ row: rowIndex, reason: "Online income requires an account_name" });
          continue;
        }

        const description = cellToString(row.description);
        const amountPaise = Math.round(amountNum * 100);
        if (description.length > 500) {
          results.failed.push({ row: rowIndex, reason: "description must be 500 characters or fewer" });
          continue;
        }
        if (amountPaise <= 0) {
          results.failed.push({ row: rowIndex, reason: "Amount must be at least ₹0.01" });
          continue;
        }

        // Duplicate check: same date + amount + source + description
        const existing = await db
          .select({ id: dailyIncome.id })
          .from(dailyIncome)
          .where(
            and(
              eq(dailyIncome.date, dateStr),
              eq(dailyIncome.amount, amountPaise),
              eq(dailyIncome.source, source),
              sql`LOWER(COALESCE(${dailyIncome.sourceDetail}, '')) = LOWER(${source === "other" ? sourceDetail : ""})`,
              sql`LOWER(${dailyIncome.description}) = LOWER(${description})`
            )
          )
          .limit(1);

        if (existing.length > 0) {
          results.skipped++;
          continue;
        }

        await db.insert(dailyIncome).values({
          date: dateStr,
          accountId,
          type,
          amount: amountPaise,
          source,
          sourceDetail: source === "other" ? sourceDetail : "",
          description,
          createdBy: actorName,
          createdAt: new Date().toISOString(),
        });
        results.inserted++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Database insert failed";
        results.failed.push({ row: rowIndex, reason: message });
      }
    }
  }

  return results;
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";

  // Template download (JSON body with action)
  if (contentType.includes("application/json")) {
    const body = await req.json();
    const password = body.password as string;
    const username = body.username as string | undefined;

    if (!await authenticateSimple(password, username)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (body.action === "expenseTemplate") {
      const categories = parseExpenseCategories(await getSetting("expense_categories"));
      const columns = EXPENSE_COLUMNS.map((column) => column.header === "category" ? { ...column, description: `${categories.join(" / ")} (required)` } : column);
      const buf = generateTemplate(columns, "Expense Records");
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="expense_import_template.xlsx"',
        },
      });
    }

    if (body.action === "incomeTemplate") {
      const categories = parseIncomeCategories(await getSetting("income_categories"));
      const columns = INCOME_COLUMNS.map((column) => column.header === "source" ? { ...column, description: `${categories.map((item) => item.name).join(" / ")} (default: ${categories[0]?.name || "none"})` } : column);
      const buf = generateTemplate(columns, "Income Records");
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="income_import_template.xlsx"',
        },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  // File import (multipart form data)
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const password = formData.get("password") as string;
  const username = formData.get("username") as string | undefined;
  const importType = formData.get("importType") as string;

  if (!await authenticateSimple(password, username)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
  }

  if (!importType || !["expenses", "income"].includes(importType)) {
    return NextResponse.json({ error: "importType must be 'expenses' or 'income'" }, { status: 400 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) {
      return NextResponse.json({ error: "Empty workbook" }, { status: 400 });
    }

    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, {
      defval: "",
      raw: true,
    });

    // Skip description/helper rows
    const rows = rawRows.filter((row) => {
      const dateVal = cellToString(row.date);
      return dateVal && !dateVal.toLowerCase().includes("required") && !dateVal.toLowerCase().includes("yyyy");
    });

    if (rows.length === 0) {
      return NextResponse.json({ error: "No data rows found in the file" }, { status: 400 });
    }

    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (${rows.length}). Maximum ${MAX_ROWS} rows per upload.` },
        { status: 400 }
      );
    }

    const actorName = (username as string) || "admin";

    const results = importType === "expenses"
      ? await importExpenses(rows, actorName)
      : await importIncome(rows, actorName);

    addSystemLog({
      level: "info",
      source: `bulk-import-${importType}`,
      message: `Bulk ${importType} import: ${results.inserted} inserted, ${results.skipped} skipped, ${results.failed.length} failed out of ${results.total} rows`,
    }).catch(() => {});

    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Import failed";
    addSystemLog({
      level: "error",
      source: `bulk-import-${importType}`,
      message,
    }).catch(() => {});
    return NextResponse.json(
      { error: "Failed to process file. Ensure it's a valid .xlsx file." },
      { status: 500 }
    );
  }
}
