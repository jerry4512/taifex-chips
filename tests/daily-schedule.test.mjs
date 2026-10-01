import assert from "node:assert/strict";
import test from "node:test";
import { runDailySchedule, taipeiClock } from "../lib/daily-schedule.ts";

// 2026-09-29 是週二；台北 = UTC+8。
const TODAY = "2026-09-29";
const at = (taipeiTime, date = TODAY) => new Date(`${date}T${taipeiTime}:00+08:00`);

/**
 * 今天的項目直接寫 job 名稱（"night"），其他日期寫 "YYYY-MM-DD:job"。
 * 預設視為今天已補抓過，只有 backfill: true 的案例才測補抓。
 */
function fakeDeps({ stored = [], available = [], failing = [], sendOk = true, backfill = false } = {}) {
  const key = (date, job) => (date === TODAY ? job : `${date}:${job}`);
  const done = new Set(backfill ? stored : [...stored, "backfill"]);
  const calls = { fetched: [], reports: 0, notices: [], logs: [] };
  const fetchJob = (job) => async (date) => {
    const id = key(date, job);
    calls.fetched.push(id);
    if (failing.includes(id)) throw new Error(`${id} 上游失敗`);
    if (!available.includes(id)) return false;
    done.add(id);
    return true;
  };
  return {
    calls,
    done,
    deps: {
      earliestDate: "2026-09-21",
      isDone: async (date, job) => done.has(key(date, job)),
      markDone: async (date, job) => void done.add(key(date, job)),
      fetchNight: fetchJob("night"),
      fetchDay: fetchJob("day"),
      fetchSpot: fetchJob("spot"),
      sendReport: async () => {
        calls.reports += 1;
        return sendOk;
      },
      sendMissingNotice: async (_date, missing) => {
        calls.notices.push(missing);
        return sendOk;
      },
      log: (level, message) => void calls.logs.push(`${level} ${message}`),
    },
  };
}

test("taipeiClock converts to Taipei date, weekday and HH:MM", () => {
  assert.deepEqual(taipeiClock(new Date("2026-09-29T06:50:00Z")), {
    date: "2026-09-29",
    weekday: 2,
    time: "14:50",
  });
  assert.deepEqual(taipeiClock(new Date("2026-10-02T16:30:00Z")), {
    date: "2026-10-03",
    weekday: 6,
    time: "00:30",
  });
});

test("skips weekends and times before 14:50 without fetching", async () => {
  for (const now of [at("14:45"), at("15:00", "2026-10-03"), at("15:00", "2026-10-04")]) {
    const { deps, calls } = fakeDeps({ available: ["night", "day", "spot"] });
    const result = await runDailySchedule(now, deps);
    assert.equal(result.status, "skipped");
    assert.deepEqual(calls.fetched, []);
  }
});

test("only fetches the jobs that are still missing", async () => {
  const { deps, calls } = fakeDeps({ stored: ["night"], available: ["day"] });
  const result = await runDailySchedule(at("14:55"), deps);
  assert.deepEqual(calls.fetched, ["day", "spot"]);
  assert.equal(result.status, "waiting");
  assert.deepEqual(result.missing, ["spot"]);
  assert.equal(calls.reports, 0);
});

test("sends the report once all three are in and marks it done", async () => {
  const { deps, calls, done } = fakeDeps({ stored: ["night"], available: ["day", "spot"] });
  const result = await runDailySchedule(at("15:10"), deps);
  assert.equal(result.status, "reported");
  assert.equal(calls.reports, 1);
  assert.ok(done.has("report"));

  const again = await runDailySchedule(at("15:15"), deps);
  assert.equal(again.status, "done");
  assert.equal(calls.reports, 1);
  assert.deepEqual(calls.fetched, ["day", "spot"]);
});

test("retries the report next round when every recipient failed", async () => {
  const { deps, calls, done } = fakeDeps({
    stored: ["night", "day", "spot"],
    sendOk: false,
  });
  const result = await runDailySchedule(at("15:10"), deps);
  assert.equal(result.status, "waiting");
  assert.equal(calls.reports, 1);
  assert.ok(!done.has("report"));
});

test("upstream errors are reported but do not stop the other jobs", async () => {
  const { deps, calls } = fakeDeps({ failing: ["night"], available: ["day", "spot"] });
  const result = await runDailySchedule(at("15:00"), deps);
  assert.deepEqual(calls.fetched, ["night", "day", "spot"]);
  assert.deepEqual(result.missing, ["night"]);
  assert.equal(result.errors.night, "night 上游失敗");
});

test("gives up at 18:00 with a missing-data notice, sent only once", async () => {
  const { deps, calls, done } = fakeDeps({ stored: ["night"], available: ["spot"] });
  const early = await runDailySchedule(at("17:55"), deps);
  assert.equal(early.status, "waiting");
  assert.deepEqual(calls.notices, []);

  const result = await runDailySchedule(at("18:00"), deps);
  assert.equal(result.status, "gave-up");
  assert.deepEqual(calls.notices, [["day"]]);
  assert.equal(calls.reports, 0);
  assert.ok(done.has("missing-notice"));

  const later = await runDailySchedule(at("18:05"), deps);
  assert.equal(later.status, "done");
  assert.equal(calls.notices.length, 1);
});

test("still sends the full report if data completes in the 18:00 round", async () => {
  const { deps, calls } = fakeDeps({ stored: ["night", "spot"], available: ["day"] });
  const result = await runDailySchedule(at("18:00"), deps);
  assert.equal(result.status, "reported");
  assert.equal(calls.reports, 1);
  assert.deepEqual(calls.notices, []);
});

test("first round backfills missing weekdays of the past 7 days, oldest first", async () => {
  const { deps, calls, done } = fakeDeps({
    backfill: true,
    stored: ["2026-09-22:night", "2026-09-22:day", "2026-09-24:night", "2026-09-24:day", "night"],
    available: ["2026-09-23:day", "2026-09-25:night", "2026-09-25:day", "2026-09-28:night"],
    failing: ["2026-09-28:day"],
  });
  const result = await runDailySchedule(at("14:50"), deps);

  // 9/26、9/27 是週末；9/21 以前不在範圍；9/22、9/24 已存在。
  assert.deepEqual(calls.fetched, [
    "2026-09-23:night",
    "2026-09-23:day",
    "2026-09-25:night",
    "2026-09-25:day",
    "2026-09-28:night",
    "2026-09-28:day",
    "day",
    "spot",
  ]);
  assert.deepEqual(result.backfill, [
    { date: "2026-09-23", job: "night", status: "missing" },
    { date: "2026-09-23", job: "day", status: "filled" },
    { date: "2026-09-25", job: "night", status: "filled" },
    { date: "2026-09-25", job: "day", status: "filled" },
    { date: "2026-09-28", job: "night", status: "filled" },
    { date: "2026-09-28", job: "day", status: "error", error: "2026-09-28:day 上游失敗" },
  ]);
  assert.ok(done.has("backfill"));
  assert.equal(calls.reports, 0);
});

test("backfill runs only once a day even if some dates are still missing", async () => {
  const { deps, calls } = fakeDeps({ backfill: true, stored: ["night", "day"] });
  await runDailySchedule(at("14:50"), deps);
  const firstRound = calls.fetched.length;
  assert.ok(firstRound > 1);

  const second = await runDailySchedule(at("14:55"), deps);
  assert.deepEqual(calls.fetched.slice(firstRound), ["spot"]);
  assert.deepEqual(second.backfill, []);
});

test("backfill does not resend old reports and today's report still goes out", async () => {
  const { deps, calls } = fakeDeps({
    backfill: true,
    available: ["2026-09-28:night", "2026-09-28:day", "night", "day", "spot"],
  });
  const result = await runDailySchedule(at("15:20"), deps);
  assert.equal(result.status, "reported");
  assert.equal(calls.reports, 1);
  assert.deepEqual(calls.notices, []);
});

test("backfill window never goes before the earliest supported date", async () => {
  const { deps, calls } = fakeDeps({ backfill: true, stored: ["night", "day", "spot"] });
  await runDailySchedule(at("14:50", "2026-09-22"), deps);
  assert.deepEqual(
    calls.fetched.filter((id) => id.includes(":")),
    ["2026-09-21:night", "2026-09-21:day", "2026-09-22:night", "2026-09-22:day", "2026-09-22:spot"],
  );
});

test("skipped and already-done rounds write no log", async () => {
  const { deps, calls } = fakeDeps({ stored: ["night", "day", "spot", "report"] });
  await runDailySchedule(at("14:45"), deps);
  await runDailySchedule(at("15:00", "2026-10-03"), deps);
  await runDailySchedule(at("15:30"), deps);
  assert.deepEqual(calls.logs, []);
});

test("logs each job's outcome and the report result with a Taipei time prefix", async () => {
  const { deps, calls } = fakeDeps({ stored: ["night"], available: ["day", "spot"] });
  await runDailySchedule(at("15:10"), deps);
  assert.deepEqual(calls.logs, [
    "info [排程 2026-09-29 15:10] 期交所夜盤：資料庫已有，略過",
    "info [排程 2026-09-29 15:10] 期交所日盤：已取得並存入",
    "info [排程 2026-09-29 15:10] 證交所三大法人：已取得並存入",
    "info [排程 2026-09-29 15:10] 三項到齊，籌碼報告推播成功",
  ]);
});

test("logs upstream errors, failed reports and what is still missing", async () => {
  const failing = fakeDeps({ failing: ["night"], available: ["day"] });
  await runDailySchedule(at("15:00"), failing.deps);
  assert.deepEqual(failing.calls.logs, [
    "error [排程 2026-09-29 15:00] 期交所夜盤：抓取失敗：night 上游失敗",
    "info [排程 2026-09-29 15:00] 期交所日盤：已取得並存入",
    "info [排程 2026-09-29 15:00] 證交所三大法人：尚未公布",
    "info [排程 2026-09-29 15:00] 仍缺 期交所夜盤、證交所三大法人，下一輪再試",
  ]);

  const unsent = fakeDeps({ stored: ["night", "day", "spot"], sendOk: false });
  await runDailySchedule(at("15:10"), unsent.deps);
  assert.deepEqual(unsent.calls.logs.slice(-1), [
    "error [排程 2026-09-29 15:10] 籌碼報告推播失敗：所有收件人都傳送失敗，下一輪重試",
  ]);
});

test("logs the 18:00 missing-data notice", async () => {
  const { deps, calls } = fakeDeps({ stored: ["night", "spot"] });
  await runDailySchedule(at("18:00"), deps);
  assert.deepEqual(calls.logs.slice(-1), [
    "info [排程 2026-09-29 18:00] 已過 18:00 仍缺 期交所日盤，缺漏通知推播成功，今天不再重試",
  ]);
});

test("logs each backfilled date, or that nothing needed backfilling", async () => {
  const { deps, calls } = fakeDeps({
    backfill: true,
    stored: ["2026-09-22:night", "2026-09-22:day", "2026-09-23:night", "2026-09-23:day", "2026-09-24:night", "2026-09-24:day", "2026-09-28:night", "night", "day", "spot"],
    available: ["2026-09-25:night"],
    failing: ["2026-09-28:day"],
  });
  await runDailySchedule(at("14:50"), deps);
  assert.deepEqual(calls.logs, [
    "info [排程 2026-09-29 14:50] 補抓 2026-09-25 期交所夜盤：已補上",
    "info [排程 2026-09-29 14:50] 補抓 2026-09-25 期交所日盤：查無資料（可能是休市日）",
    "error [排程 2026-09-29 14:50] 補抓 2026-09-28 期交所日盤：抓取失敗：2026-09-28:day 上游失敗",
    "info [排程 2026-09-29 14:50] 期交所夜盤：資料庫已有，略過",
    "info [排程 2026-09-29 14:50] 期交所日盤：資料庫已有，略過",
    "info [排程 2026-09-29 14:50] 證交所三大法人：資料庫已有，略過",
    "info [排程 2026-09-29 14:50] 三項到齊，籌碼報告推播成功",
  ]);

  const complete = fakeDeps({ backfill: true, stored: ["2026-09-21:night"] });
  complete.deps.isDone = async (date, job) => job !== "backfill" && !(date === TODAY && ["report", "missing-notice"].includes(job));
  await runDailySchedule(at("14:50"), complete.deps);
  assert.deepEqual(complete.calls.logs.slice(0, 1), [
    "info [排程 2026-09-29 14:50] 最近 7 天的夜盤、日盤都已齊全，不需補抓",
  ]);
});
