import { NextResponse } from "next/server";
import { getSetting } from "@/db/queries";

export async function GET() {
  try {
    const value = await getSetting("image_validation");
    return NextResponse.json({ image_validation: value || "on" });
  } catch (error: any) {
    console.error("Settings error:", error?.message);
    return NextResponse.json({ image_validation: "on" });
  }
}
