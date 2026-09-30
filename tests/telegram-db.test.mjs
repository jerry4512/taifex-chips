import assert from "node:assert/strict";
import test from "node:test";
import { listTelegramRecipients } from "../lib/telegram-db.ts";

/** 模擬 postgres.js 的 tagged template：回傳預設列，或丟出指定錯誤。 */
function fakeSql({ rows = [], error } = {}) {
  return async () => {
    if (error) throw error;
    return rows;
  };
}

test("listTelegramRecipients falls back to the chat id when the label is blank", async () => {
  const sql = fakeSql({
    rows: [
      { chat_id: "123", label: "手機" },
      { chat_id: "-1001", label: "  " },
    ],
  });
  assert.deepEqual(await listTelegramRecipients(sql), [
    { label: "手機", chatId: "123" },
    { label: "-1001", chatId: "-1001" },
  ]);
});

test("listTelegramRecipients treats a missing table as no recipients", async () => {
  const missing = Object.assign(new Error('relation "telegram_recipients" does not exist'), { code: "42P01" });
  assert.deepEqual(await listTelegramRecipients(fakeSql({ error: missing })), []);
});

test("listTelegramRecipients rethrows other database errors", async () => {
  const refused = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
  await assert.rejects(listTelegramRecipients(fakeSql({ error: refused })), refused);
});
