import { NextResponse } from "next/server";
import { getSettingValue } from "@/lib/googleApiFetch";

export async function GET() {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ image_validation: "on" });
    }
    const value = await getSettingValue(spreadsheetId, "image_validation");
    return NextResponse.json({ image_validation: value || "on" });
  } catch {
    return NextResponse.json({ image_validation: "on" });
  }
}
