import { NextRequest, NextResponse } from "next/server";
import { getLatestCheckinByContact } from "@/db/queries";
import { checkinLookupData } from "@/lib/checkinLookup";

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone")?.replace(/[\s\-]/g, "") || "";

  if (!phone || phone.length < 7) {
    return NextResponse.json({ found: false });
  }

  try {
    const record = await getLatestCheckinByContact(phone);

    if (!record) {
      return NextResponse.json({ found: false });
    }

    return NextResponse.json({
      found: true,
      data: await checkinLookupData(record),
    });
  } catch (error: any) {
    console.error("Lookup error:", error?.message || error);
    return NextResponse.json({ found: false });
  }
}
