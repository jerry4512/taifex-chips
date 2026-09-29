declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    /** BotFather 給的 token，見 .env.example。 */
    TELEGRAM_BOT_TOKEN?: string;
    /** 逗號分隔的收件人，格式 `標籤:chatId`，見 .env.example。 */
    TELEGRAM_CHAT_IDS?: string;
    /** 存登入帳號的 Postgres 連線字串，帳號用 `npm run users` 管理。 */
    DATABASE_URL?: string;
  }
}
