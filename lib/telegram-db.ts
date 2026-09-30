/**
 * Telegram 收件人存在 Postgres（與登入帳號同一個 DATABASE_URL），用 `npm run recipients` 管理。
 * 推播次數很少，每次都重新讀取，改完收件人不必重啟伺服器。
 * 不 import 其他 lib 模組，讓 scripts 與測試能用 Node 原生 type stripping 直接載入。
 */
import type postgres from "postgres";
import type { TelegramChatTarget } from "./telegram";

export const RECIPIENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS telegram_recipients (
  chat_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

/** Postgres 的 undefined_table 錯誤碼。 */
const UNDEFINED_TABLE = "42P01";

type Sql = postgres.Sql;

export async function ensureRecipientsTable(sql: Pick<Sql, "unsafe">): Promise<void> {
  await sql.unsafe(RECIPIENTS_TABLE_SQL);
}

/**
 * 依新增順序列出收件人；標籤空白時以 chatId 顯示。
 * 資料表還不存在（從沒新增過收件人）視同沒有收件人，由呼叫端提示如何新增。
 */
export async function listTelegramRecipients(sql: Sql): Promise<TelegramChatTarget[]> {
  try {
    const rows = await sql<{ chat_id: string; label: string }[]>`
      SELECT chat_id, label FROM telegram_recipients ORDER BY created_at, chat_id
    `;
    return rows.map((row) => ({ label: row.label.trim() || row.chat_id, chatId: row.chat_id }));
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === UNDEFINED_TABLE) return [];
    throw error;
  }
}

/** chatId 已存在時改標籤。回傳 true 表示新增。chatId 格式由呼叫端先用 `isValidChatId` 檢查。 */
export async function upsertTelegramRecipient(sql: Sql, chatId: string, label: string): Promise<boolean> {
  const rows = await sql<{ inserted: boolean }[]>`
    INSERT INTO telegram_recipients (chat_id, label) VALUES (${chatId}, ${label.trim() || chatId})
    ON CONFLICT (chat_id) DO UPDATE SET label = EXCLUDED.label, updated_at = now()
    RETURNING (xmax = 0) AS inserted
  `;
  return rows[0].inserted;
}

export async function deleteTelegramRecipient(sql: Sql, chatId: string): Promise<boolean> {
  const rows = await sql`DELETE FROM telegram_recipients WHERE chat_id = ${chatId} RETURNING chat_id`;
  return rows.length > 0;
}
