import assert from "node:assert/strict";
import test from "node:test";
import {
  bfi82uUrl,
  combineBfi82u,
  fetchBfi82u,
  fetchLatestBfi82u,
  groupBfi82uDays,
  parseBfi82u,
  parseBfi82uRaw,
} from "../lib/twse.ts";

const payload = {
  stat: "OK",
  date: "20260924",
  data: [
    ["自營商(自行買賣)", "9,882,509,551", "5,646,973,463", "4,235,536,088"],
    ["自營商(避險)", "23,087,221,537", "25,984,327,204", "-2,897,105,667"],
    ["投信", "12,394,374,441", "23,803,693,688", "-11,409,319,247"],
    ["外資及陸資(不含外資自營商)", "266,255,890,893", "300,057,954,548", "-33,802,063,655"],
    ["外資自營商", "0", "0", "0"],
    ["合計", "311,619,996,422", "355,492,948,903", "-43,872,952,481"],
  ],
};

test("parses and combines the latest TWSE institutional flows", () => {
  const parsed = parseBfi82u(payload);

  assert.equal(parsed.date, "2026-09-24");
  assert.deepEqual(parsed.data[2], {
    name: "自營商",
    buy: 32969731088,
    sell: 31631300667,
    difference: 1338430421,
  });
  assert.deepEqual(parsed.data[3], {
    name: "三大法人合計",
    buy: 311619996422,
    sell: 355492948903,
    difference: -43872952481,
  });
});

test("parseBfi82uRaw keeps every TWSE row with its raw buy and sell amounts", () => {
  const raw = parseBfi82uRaw(payload);
  assert.equal(raw.date, "2026-09-24");
  assert.equal(raw.rows.length, 6);
  assert.deepEqual(raw.rows[0], { item: "自營商(自行買賣)", buy: 9882509551, sell: 5646973463 });
  assert.deepEqual(raw.rows[4], { item: "外資自營商", buy: 0, sell: 0 });
});

test("combineBfi82u rebuilds the same flows from stored raw rows", () => {
  const raw = parseBfi82uRaw(payload);
  // 從資料庫讀回來時列的順序不保證，合併結果不能受影響。
  assert.deepEqual(combineBfi82u({ date: raw.date, rows: [...raw.rows].reverse() }), parseBfi82u(payload));
  for (const [index, row] of payload.data.entries()) {
    const difference = Number(row[3].replaceAll(",", ""));
    assert.equal(raw.rows[index].buy - raw.rows[index].sell, difference);
  }
});

test("parseBfi82uRaw rejects payloads missing a required row so nothing partial gets saved", () => {
  assert.throws(
    () => parseBfi82uRaw({ ...payload, data: payload.data.filter((row) => row[0] !== "投信") }),
    /資料欄位不完整/,
  );
});

function jsonFetcher(body, calls = []) {
  return async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

test("bfi82uUrl asks TWSE for a specific day only when a date is given", () => {
  assert.equal(bfi82uUrl(), "https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json");
  assert.equal(
    bfi82uUrl("2026-09-24"),
    "https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day&dayDate=20260924",
  );
  assert.throws(() => bfi82uUrl("2026/09/24"), /請選擇有效日期/);
});

test("fetchBfi82u fetches the requested day", async () => {
  const calls = [];
  const raw = await fetchBfi82u("2026-09-24", jsonFetcher(payload, calls));
  assert.equal(raw.date, "2026-09-24");
  assert.equal(raw.rows.length, 6);
  assert.match(calls[0], /dayDate=20260924/);
});

test("fetchBfi82u rejects non-trading days instead of saving another day", async () => {
  await assert.rejects(
    fetchBfi82u("2026-09-26", jsonFetcher({ stat: "很抱歉，沒有符合條件的資料!" })),
    /該日期沒有證交所資料/,
  );
  // 證交所若回了別天的資料，也不能存成指定的日期。
  await assert.rejects(fetchBfi82u("2026-09-25", jsonFetcher(payload)), /該日期沒有證交所資料/);
});

test("fetchLatestBfi82u still asks for the latest day without a date", async () => {
  const calls = [];
  const raw = await fetchLatestBfi82u(jsonFetcher(payload, calls));
  assert.equal(raw.date, "2026-09-24");
  assert.doesNotMatch(calls[0], /dayDate/);
});

test("groupBfi82uDays combines stored rows per day, oldest first", () => {
  const day1 = parseBfi82uRaw(payload);
  const day2 = parseBfi82uRaw({ ...payload, date: "20260925" });
  const stored = [
    ...day2.rows.map((row) => ({ date: day2.date, ...row })),
    ...[...day1.rows].reverse().map((row) => ({ date: day1.date, ...row })),
  ];
  const days = groupBfi82uDays(stored);
  assert.deepEqual(days.map((day) => day.date), ["2026-09-24", "2026-09-25"]);
  assert.deepEqual(days[0].flows, parseBfi82u(payload).data);
  assert.deepEqual(groupBfi82uDays([]), []);
});
