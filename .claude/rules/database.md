---
paths:
  - "db/**"
  - "drizzle/**"
  - "drizzle.config.ts"
  - "lib/futures-db.ts"
---

# 籌碼資料庫規則（Postgres）

- **只存期交所揭露的原始口數**。約當換算、日變化、推估值、籌碼解讀都在 `listFuturesPositions` / `listNightlyPositions` 讀取時計算，新增欄位前先問：能否從原始口數算出？能就不要存。
- **改 schema 必須三處同步**：
  1. `db/schema.ts`（Drizzle 定義）
  2. `npx drizzle-kit generate` 產生新的 `drizzle/NNNN_*.sql`（不要手改既有遷移檔）
  3. `lib/futures-db.ts` 的 `FUTURES_TABLES_SQL` 手寫 `CREATE TABLE IF NOT EXISTS`，以及 `createSchema` 的 `ON CONFLICT DO NOTHING` 種子資料
- 寫入用 `INSERT ... ON CONFLICT(date) DO UPDATE`，重抓同一天即覆蓋更正；`collected_at` 保留首次寫入時間，只更新 `updated_at = now()`。日期欄位用 `TEXT`（`YYYY-MM-DD`），不要改成 `DATE`——postgres.js 會轉成 `Date` 物件，破壞字串比較。
- 取得連線一律經過 `withDatabase()`（每次開一條連線、遇到 `42P01` 才建表重試）；同一次讀取要查多張表時放在同一個 `withDatabase` 裡，不要一次請求開多條連線。
- `daily_futures_positions.night_equivalent_net` 是已知冗餘欄位（與 `nightly_futures_positions` 重複）。除非使用者明確要求，不要順手移除或改成跨表計算——會改動下午 SOP 的既有流程。
