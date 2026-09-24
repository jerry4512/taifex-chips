import { NextResponse } from "next/server";
import { getLatestBfi82u } from "../../../../lib/twse";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getLatestBfi82u(), {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法取得證交所資料";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
