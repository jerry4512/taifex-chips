# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

「台指期籌碼」：抓期交所外資台指期（大台／小台／微台）未平倉與證交所三大法人買賣金額，實作試算表 `期貨.xlsx`「外資籌碼統計」的兩段 SOP（早上夜盤推估、下午純日盤判讀），並可推播到 Telegram。資料自 2026/09/21 起（`lib/taifex.ts` 的 `DEFAULT_START_DATE`）。README.md 有完整的欄位對照表、計算公式與 API 清單，修改計算或資料表前先讀它。

## 常用指令

需要 Node.js ≥ 22.13。

```bash
npm run dev          # vinext dev（Vite + Cloudflare 外掛，本機 D1 由 miniflare 模擬），http://localhost:3000
npm run build        # 輸出到 dist/
npm test             # 先 build，再 node --test tests/*.test.mjs
npm run lint         # eslint
npx drizzle-kit generate   # 依 db/schema.ts 產生 drizzle/ 遷移
```

跑單一測試檔或單一測試（測試直接 import `lib/*.ts`，靠 Node 原生 type stripping，不需 build）：

```bash
node --test tests/taifex.test.mjs
node --test --test-name-pattern="full-day" tests/taifex.test.mjs
```

例外：`tests/rendered-html.test.mjs` 會 import `dist/server/index.js` 做 SSR 渲染斷言，必須先 `npm run build`。改動頁面文字時要同步更新這支測試裡的 regex。

`啟動工具.command` 是給非開發者從 Finder 雙擊啟動 `npm run dev` 並自動開瀏覽器的腳本。

## 架構

- **執行環境**：不是一般 Next.js。使用 `vinext`（以 Vite 實作 Next App Router API）跑在 Cloudflare Workers 上；`worker/index.ts` 是 Worker 入口，`vite.config.ts` 設定本機 binding（D1 綁定名 `DB` 來自 `.openai/hosting.json`）。`build/sites-vite-plugin.ts` 在 build 後把 `hosting.json` 與 `drizzle/` 複製進 `dist/.openai/` 供部署平台套用遷移。
- **存取 Cloudflare env**：伺服器端一律用 `await import("cloudflare:workers")` 取 `env`（D1 在 `lib/futures-db.ts`，Telegram secret 在 `telegram-test` route）。本機 `.env` 只在啟動時讀取；正式環境用 `wrangler secret put`。
- **分層**：
  - `lib/taifex.ts`：抓期交所 HTML（`futContractsDate` 全日、`futContractsDateAh` 夜盤）、解析外資淨口數、純函式計算（`equivalentTxContracts`、`excelRound`、`estimateOpenEquivalentNetOi`、`interpretChipChange`）、台北時區日期工具。
  - `lib/twse.ts`：證交所 BFI82U JSON 解析。
  - `lib/futures-db.ts`：D1 讀寫，並在讀取時算出所有衍生欄位。
  - `lib/auth.ts`：帳號密碼登入（`AUTH_USERS` 存 PBKDF2 雜湊、`AUTH_SECRET` 簽 cookie）。`worker/index.ts` 在交給 vinext 前呼叫 `gateRequest` 擋下未登入請求，只有 `/login`、`/api/auth/*` 與靜態檔公開。
  - `lib/telegram.ts`：收件人解析（`TELEGRAM_CHAT_IDS` 格式 `標籤:chatId,...`）、組報告文字、廣播。
  - `app/api/trading-doctor/*/route.ts`：薄薄一層，`GET` 只讀資料庫不連外，`POST {"date"}` 才去期交所抓並寫入。
  - `app/page.tsx`：單一 client component 儀表板，透過上述 API 操作。

## 關鍵慣例與陷阱

各領域的細部規則在 `.claude/rules/`（依 `paths` 自動套用）：`chip-calculation.md`（公式、excelRound、交易日歸屬）、`database.md`（只存原始口數、schema 三處同步）、`frontend.md`（紅漲綠跌、測試同步）、`api-and-telegram.md`（route 慣例、secret）。跨領域的共通原則：

- 資料庫只存期交所原始口數，衍生值一律讀取時計算。
- 四捨五入用 `excelRound`，不可用 `Math.round`。
- UI 與錯誤訊息皆為繁體中文。

查看本機 D1 資料（需排除 miniflare 的 `metadata.sqlite`）：

```bash
sqlite3 "$(ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | grep -v metadata)" \
  "SELECT * FROM nightly_futures_positions ORDER BY date;"
```
