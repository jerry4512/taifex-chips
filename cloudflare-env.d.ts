declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    /** BotFather 給的 token，見 .env.example。 */
    TELEGRAM_BOT_TOKEN?: string;
    /** 逗號分隔的收件人，格式 `標籤:chatId`，見 .env.example。 */
    TELEGRAM_CHAT_IDS?: string;
  }
}
