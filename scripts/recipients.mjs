// 管理 Telegram 推播收件人（存在 DATABASE_URL 指向的 Postgres）：
//   npm run recipients -- add chatId [標籤]   新增收件人，或幫既有 chatId 改標籤
//   npm run recipients -- remove chatId       刪除收件人
//   npm run recipients -- list                列出所有收件人
// 個人 chat ID 為正數、群組為負數、公開頻道可用 @username；標籤只作顯示用，可含空白。
// DATABASE_URL 從環境變數或 .env 讀取。postgres.railway.internal 只有 Railway 內部連得到，
// 在自己電腦上執行時請改用 Railway 後台 Postgres 的 DATABASE_PUBLIC_URL。
import { argv, env, exit } from "node:process";
import { withSql } from "../lib/auth-db.ts";
import { isValidChatId } from "../lib/telegram.ts";
import {
  deleteTelegramRecipient,
  ensureRecipientsTable,
  listTelegramRecipients,
  upsertTelegramRecipient,
} from "../lib/telegram-db.ts";

const USAGE = "用法：npm run recipients -- add chatId [標籤] | remove chatId | list";
const [command, chatId, ...labelParts] = argv.slice(2);
const label = labelParts.join(" ");
const needsChatId = command === "add" || command === "remove";

if (!["add", "remove", "list"].includes(command) || (needsChatId && !chatId)) {
  console.error(USAGE);
  exit(1);
}
if (command === "add" && !isValidChatId(chatId)) {
  console.error(`chat ID 格式錯誤：${chatId}（個人為正數、群組為負數、公開頻道為 @username）`);
  exit(1);
}

try {
  await withSql(env.DATABASE_URL, async (sql) => {
    await ensureRecipientsTable(sql);
    if (command === "add") {
      const created = await upsertTelegramRecipient(sql, chatId, label);
      console.log(created ? `已新增收件人 ${label || chatId}（${chatId}）` : `已更新 ${chatId} 的標籤為 ${label || chatId}`);
    } else if (command === "remove") {
      console.log((await deleteTelegramRecipient(sql, chatId)) ? `已刪除收件人 ${chatId}` : `找不到收件人 ${chatId}`);
    } else {
      const targets = await listTelegramRecipients(sql);
      if (targets.length === 0) console.log("目前沒有任何收件人");
      for (const target of targets) console.log(`${target.chatId}\t${target.label}`);
    }
  });
} catch (error) {
  console.error(`操作失敗：${error instanceof Error ? error.message : error}`);
  exit(1);
}
