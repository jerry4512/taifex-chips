import { NextResponse } from "next/server";
import { withSql } from "../../../../lib/auth-db";
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
  saveTwseInstitutionalFlows,
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
import { listTelegramRecipients } from "../../../../lib/telegram-db";
import { fetchLatestBfi82u } from "../../../../lib/twse";

export const dynamic = "force-dynamic";

async function telegramEnv(): Promise<TelegramEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as TelegramEnv;
}

/** 收件人每次都從 Postgres 重讀，改完不必重啟。 */
async function telegramConfig(env: TelegramEnv) {
  return readTelegramConfig(env, await withSql(env.DATABASE_URL, listTelegramRecipients));
}

async function broadcast(message: string): Promise<boolean> {
  const { token, targets } = await telegramConfig(await telegramEnv());
  const results = await broadcastTelegramMessage(token, targets, message);
  for (const result of results) {
    if (result.ok) console.log(`[排程] Telegram ${result.label}：已送出`);
    else console.error(`[排程] Telegram ${result.label}：傳送失敗：${result.error ?? "未知錯誤"}`);
  }
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
  // BFI82U 只給最新一天：照樣存起來（可能是前一交易日），但只有日期是今天才算取得。
  async fetchSpot(date) {
    const raw = await fetchLatestBfi82u();
    await saveTwseInstitutionalFlows(raw);
    return raw.date === date;
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
  log(level, message) {
    if (level === "error") console.error(message);
    else console.log(message);
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
    console.error(`[排程] 執行中斷：${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
