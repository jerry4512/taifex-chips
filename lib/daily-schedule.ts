/**
 * 平日下午自動抓取：14:50 起每 5 分鐘一輪，只補抓當天還沒拿到的資料；
 * 夜盤、日盤、證交所三項到齊才推播 Telegram 報告，18:00 仍未到齊就推播缺漏通知。
 * 每輪都先查「今天已完成哪些」，重複觸發不會重複寫入或重複推播。
 * 每天第一輪另外補抓最近 7 天內資料庫缺的平日夜盤／日盤（只補資料、不補發報告），
 * 避免前一天漏抓讓今天的純日盤變化量與開盤推估改用更早的基準而算錯。
 */

export const SCHEDULE_START_TIME = "14:50";
export const SCHEDULE_GIVE_UP_TIME = "18:00";
export const BACKFILL_DAYS = 7;

export type DailyDataJob = "night" | "day" | "spot";
export type DailyJob = DailyDataJob | "backfill" | "report" | "missing-notice";

export const DAILY_DATA_JOBS: readonly DailyDataJob[] = ["night", "day", "spot"];

export const DAILY_DATA_JOB_LABELS: Record<DailyDataJob, string> = {
  night: "期交所夜盤",
  day: "期交所日盤",
  spot: "證交所三大法人",
};

export interface TaipeiClock {
  date: string;
  /** 0 = 週日 … 6 = 週六 */
  weekday: number;
  /** HH:MM（24 小時制） */
  time: string;
}

const clockFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function taipeiClock(now: Date): TaipeiClock {
  const parts = Object.fromEntries(
    clockFormatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS.indexOf(parts.weekday),
    time: `${parts.hour}:${parts.minute}`,
  };
}

export interface DailyScheduleDeps {
  /** 補抓不早於這天（資料起始日）。 */
  earliestDate: string;
  isDone(date: string, job: DailyJob): Promise<boolean>;
  markDone(date: string, job: DailyJob): Promise<void>;
  /** 抓到並存好回傳 true；尚未公布回傳 false；上游錯誤直接丟出。 */
  fetchNight(date: string): Promise<boolean>;
  fetchDay(date: string): Promise<boolean>;
  fetchSpot(date: string): Promise<boolean>;
  /** 至少一位收件人成功即回傳 true。 */
  sendReport(date: string): Promise<boolean>;
  sendMissingNotice(date: string, missing: DailyDataJob[]): Promise<boolean>;
  /** 每一步的執行紀錄；略過與已完成的輪次不寫，避免每 5 分鐘洗版。 */
  log?(level: ScheduleLogLevel, message: string): void;
}

export type ScheduleLogLevel = "info" | "error";

export type DailyScheduleStatus =
  | "skipped"
  | "waiting"
  | "reported"
  | "gave-up"
  | "done";

export interface DailyScheduleResult {
  date: string;
  time: string;
  status: DailyScheduleStatus;
  missing: DailyDataJob[];
  errors: Partial<Record<DailyJob, string>>;
  /** 本輪補抓過去日期的結果；非當天第一輪時為空陣列。 */
  backfill: BackfillAttempt[];
}

export interface BackfillAttempt {
  date: string;
  job: "night" | "day";
  status: "filled" | "missing" | "error";
  error?: string;
}

/** date 之前 BACKFILL_DAYS 天內、不早於 earliestDate 的平日，由舊到新。 */
export function backfillDates(date: string, earliestDate: string): string[] {
  const dates: string[] = [];
  for (let offset = BACKFILL_DAYS; offset >= 1; offset -= 1) {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - offset);
    const iso = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && iso >= earliestDate) dates.push(iso);
  }
  return dates;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知錯誤";
}

function jobLabels(jobs: readonly DailyDataJob[]): string {
  return jobs.map((job) => DAILY_DATA_JOB_LABELS[job]).join("、");
}

export async function runDailySchedule(
  now: Date,
  deps: DailyScheduleDeps,
): Promise<DailyScheduleResult> {
  const { date, weekday, time } = taipeiClock(now);
  const result: DailyScheduleResult = {
    date,
    time,
    status: "skipped",
    missing: [],
    errors: {},
    backfill: [],
  };

  if (weekday === 0 || weekday === 6 || time < SCHEDULE_START_TIME) return result;

  if ((await deps.isDone(date, "report")) || (await deps.isDone(date, "missing-notice"))) {
    return { ...result, status: "done" };
  }

  // 前綴帶台北日期與時間，docker compose logs 不加 -t 也看得出是哪一輪。
  const log = (level: ScheduleLogLevel, message: string) =>
    deps.log?.(level, `[排程 ${date} ${time}] ${message}`);

  const fetchers: Record<DailyDataJob, (date: string) => Promise<boolean>> = {
    night: deps.fetchNight,
    day: deps.fetchDay,
    spot: deps.fetchSpot,
  };

  // 先補過去再抓今天，今天的報告才會用到補齊後的前一日基準。休市日永遠抓不到，所以一天只補一輪。
  if (!(await deps.isDone(date, "backfill"))) {
    for (const pastDate of backfillDates(date, deps.earliestDate)) {
      for (const job of ["night", "day"] as const) {
        if (await deps.isDone(pastDate, job)) continue;
        const label = `補抓 ${pastDate} ${DAILY_DATA_JOB_LABELS[job]}`;
        try {
          const filled = await fetchers[job](pastDate);
          result.backfill.push({ date: pastDate, job, status: filled ? "filled" : "missing" });
          log("info", `${label}：${filled ? "已補上" : "查無資料（可能是休市日）"}`);
        } catch (error) {
          result.backfill.push({ date: pastDate, job, status: "error", error: errorMessage(error) });
          log("error", `${label}：抓取失敗：${errorMessage(error)}`);
        }
      }
    }
    if (result.backfill.length === 0) {
      log("info", `最近 ${BACKFILL_DAYS} 天的夜盤、日盤都已齊全，不需補抓`);
    }
    await deps.markDone(date, "backfill");
  }

  // 依序抓，避免同時對期交所連發多個請求。
  for (const job of DAILY_DATA_JOBS) {
    const label = DAILY_DATA_JOB_LABELS[job];
    if (await deps.isDone(date, job)) {
      log("info", `${label}：資料庫已有，略過`);
      continue;
    }
    try {
      if (await fetchers[job](date)) {
        log("info", `${label}：已取得並存入`);
      } else {
        result.missing.push(job);
        log("info", `${label}：尚未公布`);
      }
    } catch (error) {
      result.missing.push(job);
      result.errors[job] = errorMessage(error);
      log("error", `${label}：抓取失敗：${errorMessage(error)}`);
    }
  }

  if (result.missing.length === 0) {
    try {
      if (await deps.sendReport(date)) {
        await deps.markDone(date, "report");
        log("info", "三項到齊，籌碼報告推播成功");
        return { ...result, status: "reported" };
      }
      result.errors.report = "所有收件人都傳送失敗";
    } catch (error) {
      result.errors.report = errorMessage(error);
    }
    log("error", `籌碼報告推播失敗：${result.errors.report}，下一輪重試`);
    return { ...result, status: "waiting" };
  }

  if (time >= SCHEDULE_GIVE_UP_TIME) {
    const missing = jobLabels(result.missing);
    try {
      if (await deps.sendMissingNotice(date, result.missing)) {
        await deps.markDone(date, "missing-notice");
        log("info", `已過 ${SCHEDULE_GIVE_UP_TIME} 仍缺 ${missing}，缺漏通知推播成功，今天不再重試`);
        return { ...result, status: "gave-up" };
      }
      result.errors["missing-notice"] = "所有收件人都傳送失敗";
    } catch (error) {
      result.errors["missing-notice"] = errorMessage(error);
    }
    log(
      "error",
      `已過 ${SCHEDULE_GIVE_UP_TIME} 仍缺 ${missing}，缺漏通知推播失敗：${result.errors["missing-notice"]}，下一輪重試`,
    );
    return { ...result, status: "waiting" };
  }

  log("info", `仍缺 ${jobLabels(result.missing)}，下一輪再試`);
  return { ...result, status: "waiting" };
}
