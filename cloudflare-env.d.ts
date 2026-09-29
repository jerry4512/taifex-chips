declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    /** BotFather 給的 token，見 .env.example。 */
    TELEGRAM_BOT_TOKEN?: string;
    /** 逗號分隔的收件人，格式 `標籤:chatId`，見 .env.example。 */
    TELEGRAM_CHAT_IDS?: string;
    /** 逗號分隔的登入帳號，格式 `帳號:pbkdf2.…`，用 `npm run hash-password` 產生。 */
    AUTH_USERS?: string;
    /** 簽章登入 cookie 用的隨機字串（至少 32 字元），更換會讓所有人登出。 */
    AUTH_SECRET?: string;
  }
}
