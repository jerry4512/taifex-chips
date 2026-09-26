---
paths:
  - "app/api/**"
  - "lib/telegram.ts"
  - "tests/telegram.test.mjs"
  - ".env.example"
---

# API 路由與 Telegram 規則

- Route 維持薄層：驗證輸入 → 呼叫 `lib/` → 回 `NextResponse.json`。商業邏輯放 `lib/`，方便用 `node --test` 直接測。
- 每個 route 都要 `export const dynamic = "force-dynamic"`；`GET` 回應加 `Cache-Control: no-store`。
- `POST {"date"}` 驗證：格式 `YYYY-MM-DD`、不早於 `DEFAULT_START_DATE`、不晚於台北今日。錯誤狀態碼慣例：輸入錯誤 400、查無資料 404、上游（期交所／證交所）失敗 502、資料庫讀取失敗 500。錯誤訊息為繁體中文 `{ error }`。
- Secret 經 `await import("cloudflare:workers")` 的 `env` 讀取；任何回應（含 `GET /telegram-test`）都不可回傳 `TELEGRAM_BOT_TOKEN`，只回報是否存在。
- `TELEGRAM_CHAT_IDS` 格式：逗號或換行分隔，每筆 `標籤:chatId` 或 `chatId`（正數個人、負數群組、`@username` 頻道），解析集中在 `parseChatTargets`。
- 推播報告要能部分失敗：現貨或期貨任一來源取不到時，只有該段顯示「尚無資料」；單一收件人傳送失敗不影響其他人，結果逐筆回報。
- 新增環境變數時同步更新 `.env.example`（含取得方式說明）與 README 的部署 `wrangler secret put` 指令。
