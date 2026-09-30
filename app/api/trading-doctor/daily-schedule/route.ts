import { NextResponse } from "next/server";
import { collectReportInput } from "../../../../lib/chip-report";
import {
  DAILY_DATA_JOB_LABELS,
  SCHEDULE_GIVE_UP_TIME,
  runDailySchedule,
  type DailyScheduleDeps,
  type DailyScheduleResult,
} from "../../../../lib/daily-schedule";
import {
  isDailyJobDone,
  markDailyJobDone,
  saveFuturesPosition,
  saveNightlyPosition,
} from "../../../../lib/futures-db";
import {
  DEFAULT_START_DATE,
  getTaifexAfterHours,
  getTaifexFutures,
} from "../../../../lib/taifex";
import {
  broadcastTelegramMessage,
  buildChipReport,
  buildMissingDataNotice,
  readTelegramConfig,
  type TelegramEnv,
} from "../../../../lib/telegram";
import { getLatestBfi82u } from "../../../../lib/twse";

export const dynamic = "force-dynamic";

async function telegramEnv(): Promise<TelegramEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as TelegramEnv;
}

async function broadcast(message: string): Promise<boolean> {
  const { token, targets } = readTelegramConfig(await telegramEnv());
  const results = await broadcastTelegramMessage(token, targets, message);
  return results.some((result) => result.ok);
}

const deps: DailyScheduleDeps = {
  earliestDate: DEFAULT_START_DATE,
  isDone: isDailyJobDone,
  markDone: markDailyJobDone,
  async fetchNight(date) {
    const positions = await getTaifexAfterHours(date);
    if (!positions) return false;
    await saveNightlyPosition(date, positions);
    return true;
  },
  async fetchDay(date) {
    const row = (await getTaifexFutures(date, date)).data.at(0);
    if (!row) return false;
    await saveFuturesPosition(row);
    return true;
  },
  // 證交所資料不存資料庫，只記「今天已取得」；報告推播時再抓一次最新值。
  async fetchSpot(date) {
    if ((await getLatestBfi82u()).date !== date) return false;
    await markDailyJobDone(date, "spot");
    return true;
  },
  async sendReport() {
    return broadcast(buildChipReport(await collectReportInput()));
  },
  async sendMissingNotice(date, missing) {
    return broadcast(
      buildMissingDataNotice(
        date,
        missing.map((job) => DAILY_DATA_JOB_LABELS[job]),
        SCHEDULE_GIVE_UP_TIME,
      ),
    );
  },
};

/** 由 compose 的 scheduler 容器每 5 分鐘呼叫；是否該抓、抓哪些由 runDailySchedule 判斷。 */
export async function POST() {
  try {
    return NextResponse.json<DailyScheduleResult>(await runDailySchedule(new Date(), deps), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法讀取資料庫";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
