import { NextResponse } from "next/server";
import {
  listNightlyPositions,
  saveNightlyPosition,
} from "../../../../lib/futures-db";
import {
  DEFAULT_START_DATE,
  getTaifexAfterHours,
  TAIFEX_AFTER_HOURS_SOURCE,
  taipeiToday,
  type TaifexAfterHoursResponse,
} from "../../../../lib/taifex";

export const dynamic = "force-dynamic";

async function databaseResponse(): Promise<TaifexAfterHoursResponse> {
  const data = await listNightlyPositions();
  return {
    startDate: data.at(0)?.date ?? DEFAULT_START_DATE,
    endDate: data.at(-1)?.date ?? taipeiToday(),
    generatedAt: new Date().toISOString(),
    source: TAIFEX_AFTER_HOURS_SOURCE,
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
    if (body.date > taipeiToday()) {
      return NextResponse.json({ error: "日期不可晚於今天" }, { status: 400 });
    }

    const positions = await getTaifexAfterHours(body.date);
    if (!positions) {
      return NextResponse.json(
        { error: "該日期沒有夜盤資料，請確認是否為交易日或盤後交易時段是否已收盤" },
        { status: 404 },
      );
    }

    await saveNightlyPosition(body.date, positions);
    return NextResponse.json({
      ...(await databaseResponse()),
      savedDate: body.date,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法取得期交所夜盤資料";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
