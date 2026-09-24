import assert from "node:assert/strict";
import test from "node:test";
import {
  broadcastTelegramMessage,
  buildChipReport,
  parseChatTargets,
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

test("parses labelled, bare, group and channel chat targets", () => {
  assert.deepEqual(
    parseChatTargets("我的手機:123456789, 交易群:-1001234567890 ,987654321,@my_channel"),
    [
      { label: "我的手機", chatId: "123456789" },
      { label: "交易群", chatId: "-1001234567890" },
      { label: "987654321", chatId: "987654321" },
      { label: "@my_channel", chatId: "@my_channel" },
    ],
  );
});

test("accepts newlines and skips blanks and comments", () => {
  assert.deepEqual(parseChatTargets("\n# 主要\n手機:1\n\n,平板:2\n"), [
    { label: "手機", chatId: "1" },
    { label: "平板", chatId: "2" },
  ]);
});

test("drops duplicate chat ids and keeps the first label", () => {
  assert.deepEqual(parseChatTargets("手機:1,備援:1"), [{ label: "手機", chatId: "1" }]);
});

test("rejects malformed entries with the offending text", () => {
  assert.throws(() => parseChatTargets("手機:abc,2"), /TELEGRAM_CHAT_IDS 格式錯誤：手機:abc/);
});

test("reports which environment variable is still missing", () => {
  assert.throws(
    () => readTelegramConfig({ TELEGRAM_CHAT_IDS: "1" }),
    /TELEGRAM_BOT_TOKEN/,
  );
  assert.throws(
    () => readTelegramConfig({ TELEGRAM_BOT_TOKEN: "  token  " }),
    /TELEGRAM_CHAT_IDS/,
  );
  assert.deepEqual(readTelegramConfig({ TELEGRAM_BOT_TOKEN: " t ", TELEGRAM_CHAT_IDS: "手機:1" }), {
    token: "t",
    targets: [{ label: "手機", chatId: "1" }],
  });
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
