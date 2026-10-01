import { NextResponse } from "next/server";
import {
  latestTwseInstitutionalFlows,
  saveTwseInstitutionalFlows,
} from "../../../../lib/futures-db";
import { fetchLatestBfi82u, type TwseBfi82uResponse } from "../../../../lib/twse";

export const dynamic = "force-dynamic";

const EMPTY_MESSAGE = "資料庫尚無證交所資料，請按「取得證交所資料」";

/** 只讀資料庫，不連證交所。 */
export async function GET() {
  try {
    const report = await latestTwseInstitutionalFlows();
    if (!report) return NextResponse.json({ error: EMPTY_MESSAGE }, { status: 404 });
    return NextResponse.json<TwseBfi82uResponse>(report, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法讀取資料庫";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 向證交所抓最新一天（BFI82U 只提供最新一天，不能指定日期）並寫入資料庫。 */
export async function POST() {
  let raw;
  try {
    raw = await fetchLatestBfi82u();
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法取得證交所資料";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  try {
    await saveTwseInstitutionalFlows(raw);
    const report = await latestTwseInstitutionalFlows();
    if (!report) return NextResponse.json({ error: EMPTY_MESSAGE }, { status: 500 });
    return NextResponse.json({ ...report, savedDate: raw.date });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法寫入資料庫";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
