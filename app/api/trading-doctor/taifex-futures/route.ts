import { NextResponse } from "next/server";
import {
  DEFAULT_START_DATE,
  getTaifexFutures,
  taipeiToday,
} from "../../../../lib/taifex";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate") ?? DEFAULT_START_DATE;
  const endDate = searchParams.get("endDate") ?? taipeiToday();

  try {
    const result = await getTaifexFutures(startDate, endDate);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法取得期交所資料";
    const isInputError =
      message.includes("日期") || message.includes("單次查詢") || message.includes("今天");
    return NextResponse.json(
      { error: message },
      { status: isInputError ? 400 : 502 },
    );
  }
}
