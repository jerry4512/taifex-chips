import { NextResponse } from "next/server";
import {
  listFuturesPositions,
  saveFuturesPosition,
} from "../../../../lib/futures-db";
import {
  DEFAULT_START_DATE,
  getTaifexFutures,
  taipeiToday,
  type TaifexFuturesResponse,
} from "../../../../lib/taifex";

export const dynamic = "force-dynamic";

const sources = {
  fullDay: "https://www.taifex.com.tw/cht/3/futContractsDate",
  night: "https://www.taifex.com.tw/cht/3/futContractsDateAh",
};

async function databaseResponse(): Promise<TaifexFuturesResponse> {
  const data = await listFuturesPositions();
  return {
    startDate: data.at(0)?.date ?? DEFAULT_START_DATE,
    endDate: data.at(-1)?.date ?? taipeiToday(),
    generatedAt: new Date().toISOString(),
    sources,
    data,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await databaseResponse(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法讀取資料庫";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { date?: unknown };
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "請選擇有效日期" }, { status: 400 });
    }
    if (body.date < DEFAULT_START_DATE) {
      return NextResponse.json(
        { error: `日期不可早於 ${DEFAULT_START_DATE.replaceAll("-", "/")}` },
        { status: 400 },
      );
    }

    const fetched = await getTaifexFutures(body.date, body.date);
    const row = fetched.data.at(0);
    if (!row) {
      return NextResponse.json(
        { error: "該日期沒有可用的期交所資料，請確認是否為交易日或資料是否已公布" },
        { status: 404 },
      );
    }

    await saveFuturesPosition(row);
    return NextResponse.json({
      ...(await databaseResponse()),
      savedDate: row.date,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法取得期交所資料";
    const isInputError = message.includes("日期") || message.includes("今天");
    return NextResponse.json(
      { error: message },
      { status: isInputError ? 400 : 502 },
    );
  }
}
