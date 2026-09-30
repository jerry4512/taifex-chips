import assert from "node:assert/strict";
import test from "node:test";
import {
  broadcastTelegramMessage,
  buildChipReport,
  buildMissingDataNotice,
  isValidChatId,
  readTelegramConfig,
} from "../lib/telegram.ts";

const spot = {
  date: "2026-09-24",
  flows: [
    { name: "外資及陸資", difference: -33802063655 },
    { name: "投信", difference: -11409319247 },
    { name: "自營商", difference: 1338430421 },
    { name: "三大法人合計", difference: -43872952481 },
  ],
};
const futures = { date: "2026-09-24", pureDayChange: 85, interpretation: "偏多" };

test("reports whether the token or the recipients are still missing", () => {
  const targets = [{ label: "手機", chatId: "1" }];
  assert.throws(() => readTelegramConfig({}, targets), /TELEGRAM_BOT_TOKEN/);
  assert.throws(
    () => readTelegramConfig({ TELEGRAM_BOT_TOKEN: "  token  " }, []),
    /尚未設定 Telegram 收件人.*npm run recipients/,
  );
  assert.deepEqual(readTelegramConfig({ TELEGRAM_BOT_TOKEN: " t " }, targets), {
    token: "t",
    targets,
  });
});

test("validates chat ids for people, groups and public channels", () => {
  for (const chatId of ["123456789", "-1001234567890", "@my_channel"]) {
    assert.equal(isValidChatId(chatId), true, chatId);
  }
  for (const chatId of ["", "abc", "12a", "@ab", "我:1"]) {
    assert.equal(isValidChatId(chatId), false, chatId);
  }
});

test("sends one message per chat and isolates failures", async () => {
  const calls = [];
  const mockFetch = async (input, init) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(input), chatId: body.chat_id, text: body.text });
    return body.chat_id === "2"
      ? Response.json({ ok: false, description: "chat not found" })
      : Response.json({ ok: true });
  };

  const results = await broadcastTelegramMessage(
    "SECRET",
    [
      { label: "手機", chatId: "1" },
      { label: "群組", chatId: "2" },
    ],
    "hi",
    mockFetch,
  );

  assert.deepEqual(results, [
    { label: "手機", chatId: "1", ok: true },
    { label: "群組", chatId: "2", ok: false, error: "chat not found" },
  ]);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.telegram.org/botSECRET/sendMessage",
      "https://api.telegram.org/botSECRET/sendMessage",
    ],
  );
  assert.deepEqual(calls.map((call) => call.text), ["hi", "hi"]);
});

test("never leaks the bot token through a failure message", async () => {
  const mockFetch = async () => Response.json({ ok: false, description: "Unauthorized" });
  const [result] = await broadcastTelegramMessage(
    "SECRET-TOKEN",
    [{ label: "手機", chatId: "1" }],
    "hi",
    mockFetch,
  );

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /SECRET-TOKEN/);
});

test("renders the chip report in the agreed layout", () => {
  assert.equal(
    buildChipReport({ spot, futures }),
    [
      "📊 台指期籌碼｜2026/09/24",
      "",
      "現貨三大法人（億元）",
      "外資 -338.0｜投信 -114.1｜自營 +13.4",
      "合計 -438.7 🟢",
      "",
      "外資期貨（約當大台／口）",
      "純日盤變化量 +85",
      "籌碼型態 偏多 🔴",
    ].join("\n"),
  );
});

test("flags a spot date that lags behind the futures date", () => {
  const report = buildChipReport({ spot: { ...spot, date: "2026-09-23" }, futures });
  assert.match(report, /^📊 台指期籌碼｜2026\/09\/24$/m);
  assert.match(report, /^現貨三大法人（億元）※2026\/09\/23$/m);
});

test("marks missing sections instead of breaking the whole report", () => {
  const noSpot = buildChipReport({ spot: null, futures });
  assert.match(noSpot, /現貨三大法人（億元）\n尚無資料/);
  assert.match(noSpot, /純日盤變化量 \+85/);

  const noFutures = buildChipReport({ spot, futures: null }, new Date("2026-09-24T03:00:00Z"));
  assert.match(noFutures, /^📊 台指期籌碼｜2026\/09\/24$/m);
  assert.match(noFutures, /純日盤變化量 尚無資料/);

  // 資料庫首日沒有前一交易日基準，純日盤變化量會是 null。
  const firstDay = buildChipReport({
    spot,
    futures: { date: "2026-09-21", pureDayChange: null, interpretation: null },
  });
  assert.match(firstDay, /純日盤變化量 尚無資料/);
});

test("uses Taiwanese colour convention for the daily direction", () => {
  assert.match(buildChipReport({ spot, futures }), /籌碼型態 偏多 🔴/);
  assert.match(
    buildChipReport({
      spot,
      futures: { date: "2026-09-23", pureDayChange: -557, interpretation: "偏空" },
    }),
    /純日盤變化量 -557\n籌碼型態 偏空 🟢/,
  );
});

test("lists what is still missing when the daily schedule gives up", () => {
  const notice = buildMissingDataNotice("2026-09-29", ["期交所日盤", "證交所三大法人"], "18:00");
  assert.match(notice, /^⚠️ 台指期籌碼｜2026\/09\/29$/m);
  assert.match(notice, /截至 18:00 仍未取得：期交所日盤、證交所三大法人/);
  assert.match(notice, /今日不推播籌碼報告/);
});
