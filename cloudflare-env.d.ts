declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    /** BotFather 給的 token，見 .env.example。 */
    TELEGRAM_BOT_TOKEN?: string;
    /** 存登入帳號與 Telegram 收件人的 Postgres 連線字串，用 `npm run users`／`npm run recipients` 管理。 */
    DATABASE_URL?: string;
  }
}
