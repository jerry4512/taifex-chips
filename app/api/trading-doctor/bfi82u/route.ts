import { NextResponse } from "next/server";
import {
  listTwseInstitutionalFlows,
  saveTwseInstitutionalFlows,
} from "../../../../lib/futures-db";
import { DEFAULT_START_DATE, taipeiToday } from "../../../../lib/taifex";
import {
  BFI82U_URL,
  fetchBfi82u,
  type TwseBfi82uListResponse,
} from "../../../../lib/twse";

export const dynamic = "force-dynamic";

async function databaseResponse(): Promise<TwseBfi82uListResponse> {
  const data = await listTwseInstitutionalFlows();
  return {
    startDate: data.at(0)?.date ?? DEFAULT_START_DATE,
    endDate: data.at(-1)?.date ?? taipeiToday(),
    generatedAt: new Date().toISOString(),
    unit: "元",
    source: BFI82U_URL,
    data,
  };
}

/** 只讀資料庫，不連證交所；回傳資料庫裡所有日期。 */
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

/** 向證交所抓指定日期（body `{"date"}`）並寫入資料庫；不帶日期時抓最新一個交易日。 */
export async function POST(request: Request) {
  let date: string | undefined;
  try {
    const text = await request.text();
    const body = (text ? JSON.parse(text) : {}) as { date?: unknown };
    if (body.date !== undefined) {
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
      date = body.date;
    }
  } catch {
    return NextResponse.json({ error: "請選擇有效日期" }, { status: 400 });
  }

  let raw;
  try {
    raw = await fetchBfi82u(date);
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法取得證交所資料";
    return NextResponse.json(
      { error: message },
      { status: message.startsWith("該日期") ? 404 : 502 },
    );
  }

  try {
    await saveTwseInstitutionalFlows(raw);
    return NextResponse.json({ ...(await databaseResponse()), savedDate: raw.date });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法寫入資料庫";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
