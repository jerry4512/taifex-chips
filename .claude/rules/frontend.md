---
paths:
  - "app/page.tsx"
  - "app/layout.tsx"
  - "app/globals.css"
  - "tests/rendered-html.test.mjs"
---

# 前端儀表板規則

- 台股配色慣例：**正值／偏多 = 紅（`--red`、`value-positive`、`signal-positive`），負值／偏空 = 綠**。與歐美相反，不要「修正」。Telegram 報告的 🔴／🟢 也遵循同一規則。
- 暗色主題，顏色用 `app/globals.css` 的 CSS 變數，不要寫死色碼。
- 所有 UI 文字、錯誤訊息用繁體中文；數字用 `zh-TW` 格式化，日期顯示為 `YYYY/MM/DD`，時間用 `Asia/Taipei`。
- `app/page.tsx` 是 client component，只透過 `/api/trading-doctor/*` 取資料，不直接 import `lib/futures-db.ts` 或任何 `cloudflare:workers` 相關模組；型別可以 `import type` 自 `lib/` 與 route 檔。
- `GET` 只讀資料庫；「取得夜盤資料」「取得資料」「取得證交所資料」按鈕才 `POST` 去抓期交所／證交所。頁面開啟時自動 `GET` 三個區塊（只讀 Postgres），但不要讓頁面載入時自動觸發 `POST`。
- 改動標題、區塊名稱或欄位文字時，同步更新 `tests/rendered-html.test.mjs` 的 regex 斷言，並用 `npm test`（含 build）驗證。
