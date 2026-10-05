# 台指期籌碼

以臺灣期貨交易所三大法人資料追蹤外資台指期籌碼，對應試算表 `期貨.xlsx`／工作表「外資籌碼統計」的兩段 SOP。資料自 2026/09/21 起。

- **早上：夜盤推估** —— 盤前用夜盤（盤後交易時段）籌碼推估開盤的外資約當淨 OI
- **下午：日盤未平倉買賣超** —— 盤後拆出扣掉夜盤後的純日盤籌碼方向
- **Telegram 推播** —— 一鍵把現貨三大法人與純日盤結果送到指定聊天室

---

## 資料庫

Postgres，連線字串為環境變數 `DATABASE_URL`（與登入帳號、Telegram 收件人同一個資料庫，見下方「登入」）。期交所籌碼兩張表、證交所現貨一張表，另有一張排程完成紀錄 `daily_schedule_jobs`；schema 定義在 `db/schema.ts`，建表 SQL 在 `drizzle/`。

`lib/futures-db.ts` 查詢時遇到「資料表不存在」（`42P01`）才 `CREATE TABLE IF NOT EXISTS`、以 `ON CONFLICT DO NOTHING` 灌入 2026/09/21–09/24 的種子資料並重試，所以空資料庫也能直接跑，平常查詢也不會多跑建表指令。Worker 不能跨請求共用連線，每次讀寫都開一條、用完即關。

### 只存原始口數，其餘即時計算

**資料庫只存期交所揭露的三商品原始口數**；約當換算、日變化、推估值、籌碼解讀都是讀取時算出來的，不落地。這樣期交所若事後更正數據，重抓當天即可，不必回頭修一整排衍生欄位。

### 表一：`nightly_futures_positions`（早上・夜盤）

| 試算表欄 | 畫面欄位 | API 欄位 | 資料庫欄位 |
| --- | --- | --- | --- |
| B | 大台夜盤買賣超 | `txNightNet` | `tx_night_net` |
| C | 小台夜盤買賣超 | `mtxNightNet` | `mtx_night_net` |
| D | 微台夜盤買賣超 | `tmfNightNet` | `tmf_night_net` |
| E | 夜盤約當買賣超 | `nightEquivalentNet` | **不儲存**（由 B、C、D 換算） |
| — | 前日官方約當淨 OI | `previousOfficialEquivalentNetOi` | **不儲存**（取前一交易日 `daily_futures_positions` 換算值） |
| F | 開盤預估約當淨 OI | `estimatedOpenEquivalentNetOi` | **不儲存**（前日官方淨 OI ＋ 夜盤約當） |

另有 `date`（主鍵，`YYYY-MM-DD`）、`collected_at`、`updated_at`。

### 表二：`daily_futures_positions`（下午・日盤）

| 試算表欄 | 畫面欄位 | API 欄位 | 資料庫欄位 |
| --- | --- | --- | --- |
| G | 大台全日買賣超 | `txNetOpenInterest` | `tx_net_open_interest` |
| H | 小台全日買賣超 | `mtxNetOpenInterest` | `mtx_net_open_interest` |
| I | 微台全日買賣超 | `tmfNetOpenInterest` | `tmf_net_open_interest` |
| J | 今日官方約當淨 OI | `officialEquivalentNetOi` | **不儲存**（由 G、H、I 換算） |
| K | 日盤籌碼總變化量 | `totalPositionChange` | **不儲存**（今日 J − 前一日 J） |
| E | （日盤用的夜盤約當） | `nightEquivalentNet` | `night_equivalent_net` |
| L | 純日盤變化量 | `pureDayChange` | **不儲存**（K − E） |
| M | 籌碼型態解讀 | `interpretation` | **不儲存**（L 的正負號） |

另有 `date`（主鍵，`YYYY-MM-DD`）、`collected_at`、`updated_at`。

### ⚠️ `night_equivalent_net` 是冗餘欄位

`daily_futures_positions.night_equivalent_net` 存的是**換算後的單一數字**，和 `nightly_futures_positions` 的三個原始欄位描述同一件事，但兩者由不同按鈕各自寫入：

- 「取得夜盤資料」→ 只寫 `nightly_futures_positions`
- 「取得資料」→ 只寫 `daily_futures_positions`

兩邊都來自期交所同一份 `futContractsDateAh`，正常情況必然一致；但若某天只按了其中一顆、期交所之後又更正數據，理論上可能不同步。要根除的話得把 `night_equivalent_net` 移除、改成一律從 `nightly_futures_positions` 即時換算 —— 這會動到下午那條既有流程，目前保留原樣。

### 表三：`twse_institutional_flows`（證交所現貨）

證交所 BFI82U 回傳的每一列原樣存一筆，主鍵為 `(date, item)`。單位為元，型別 `BIGINT`。

| 資料庫欄位 | 說明 |
| --- | --- |
| `date` | 證交所資料日期 `YYYY-MM-DD` |
| `item` | 證交所原始列名：`自營商(自行買賣)`、`自營商(避險)`、`投信`、`外資及陸資(不含外資自營商)`、`外資自營商`、`合計` |
| `buy`／`sell` | 買進金額／賣出金額 |

畫面與報告的四類法人在讀取時合併（`lib/twse.ts` 的 `combineBfi82u`）：自營商 = 自行買賣 + 避險，外資及陸資只取「不含外資自營商」那列，三大法人合計取「合計」列；**買賣差額 = 買進 − 賣出，不儲存**。BFI82U 可帶 `type=day&dayDate=YYYYMMDD` 指定日期，網頁上選日期按「取得證交所資料」即可回補單日；排程仍抓最新一個交易日。

另有 `collected_at`、`updated_at`。

### 查看與清空資料

```bash
npm run data -- list               # 各表的日期數與日期範圍
npm run data -- clear spot         # 清空證交所三大法人
npm run data -- clear night        # 清空期交所夜盤
npm run data -- clear day          # 清空期交所日盤
npm run data -- clear night,day    # 逗號分隔一次清多張
npm run data -- clear all          # 三張全部清空
```

- 清空前會列出連到哪個資料庫（只顯示主機，不印帳密）與要刪的日期範圍，**輸入 `yes` 才會刪**；加 `--yes` 可跳過確認，非互動環境沒加 `--yes` 會中止並回傳錯誤碼。
- 多張表在同一個交易裡刪除，任一張失敗就全部不刪。只刪資料、保留資料表，所以網站**不會再灌回 09/21–09/24 的種子資料**；要恢復請在網頁上逐日按「取得資料」「取得夜盤資料」重抓與「取得證交所資料」。
- 排程完成紀錄 `daily_schedule_jobs` 不受影響：當天已推播過的報告不會因清空而重發，但缺的日盤／夜盤仍會在下一輪補抓。
- `.env` 的 `DATABASE_URL` 若指向 Railway，清掉的就是正式資料，執行前先看清楚第一行顯示的資料庫位置。

直接下 SQL：

```bash
psql "$DATABASE_URL" -c "SELECT * FROM nightly_futures_positions ORDER BY date;"
```

---

## 計算規則

**約當大台換算**（`lib/taifex.ts` 的 `equivalentTxContracts`）

```
約當口數 = 大台 + ROUND(小台 ÷ 4) + ROUND(微台 ÷ 20)
```

各商品先各自四捨五入至整口。`excelRound` 採「遠離零」進位（`ROUND(-818.5) = -819`），與 Excel `ROUND` 一致，不是 JavaScript `Math.round` 的行為。

**早上推估**

```
開盤預估約當淨 OI = 前一交易日官方約當淨 OI + 今日夜盤約當買賣超
```

期交所把 D-1 15:00 至 D 05:00 的盤後交易時段歸屬於交易日 D，所以交易日當天早上就查得到該日夜盤籌碼，推估才成立。

**下午判讀**

```
日盤籌碼總變化量 = 今日官方約當淨 OI − 前一交易日官方約當淨 OI
純日盤變化量     = 日盤籌碼總變化量 − 夜盤約當買賣超
籌碼型態         = 純日盤變化量 > 0 偏多／< 0 偏空／= 0 無顯著變化
```

資料庫首日（2026/09/21）沒有前一交易日基準，變化量與籌碼解讀為空值。

---

## API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `POST` | `/api/auth/login` | 登入表單（`username`、`password`、`next`），成功設 cookie 並轉回原頁 |
| `POST` | `/api/auth/logout` | 清除登入 cookie，轉回 `/login` |
| `GET` | `/api/trading-doctor/taifex-futures-after-hours` | 讀出夜盤明細與開盤推估 |
| `POST` | `/api/trading-doctor/taifex-futures-after-hours` | `{"date":"YYYY-MM-DD"}`，抓期交所夜盤並存入資料庫 |
| `GET` | `/api/trading-doctor/taifex-futures` | 讀出日盤明細與籌碼解讀 |
| `POST` | `/api/trading-doctor/taifex-futures` | `{"date":"YYYY-MM-DD"}`，抓期交所全日與夜盤並存入資料庫 |
| `GET` | `/api/trading-doctor/bfi82u` | 讀出資料庫裡所有日期的證交所三大法人買賣金額（`data` 為 `{ date, flows }` 陣列，日期由舊到新） |
| `POST` | `/api/trading-doctor/bfi82u` | `{"date":"YYYY-MM-DD"}` 抓證交所指定日期並存入資料庫；不帶日期則抓最新一個交易日 |
| `GET` | `/api/trading-doctor/telegram-test` | 回報 Telegram 設定狀態（不含 token） |
| `POST` | `/api/trading-doctor/telegram-test` | 組出籌碼報告並推播給所有收件人 |
| `POST` | `/api/trading-doctor/daily-schedule` | 排程用：補抓今天還沒拿到的夜盤／日盤／證交所，到齊後推播（見下方「平日自動排程」） |

網頁需要先登入，未登入時會導向 `/login`；`/api/*` 不需登入，任何知道網址的人都能直接呼叫（包含會連外抓資料、寫資料庫與發 Telegram 推播的 `POST`）。

兩個 `GET` 期貨端點都是直接讀資料庫，不會連外；要更新資料請用對應的 `POST`（畫面上的「取得夜盤資料」與「取得資料」按鈕）。日期不可早於 2026/09/21，也不可晚於台北當日。

---

## Telegram 推播

Bot token 寫在 `.env`（已被 `.gitignore` 忽略），範本見 `.env.example`，內含取得 token 與 chat ID 的逐步說明。收件人存在 `DATABASE_URL` 指向的 Postgres（與登入帳號同一個資料庫，`lib/telegram-db.ts`），用指令管理：

```bash
TELEGRAM_BOT_TOKEN=8123456789:AAFk...

npm run recipients -- add 123456789 我          # 新增收件人，或幫既有 chatId 改標籤
npm run recipients -- add -1001234567890 交易群
npm run recipients -- remove 123456789          # 刪除收件人
npm run recipients -- list                      # 列出收件人
```

標籤只作顯示用，會出現在畫面與傳送結果上，省略時以 chatId 顯示。個人 chat ID 為正數、群組為負數、公開頻道可用 `@username`。收件人每次推播都從資料庫重讀，改完不用重開伺服器。

`telegram_recipients`：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `chat_id` | `TEXT PRIMARY KEY` | Telegram chat ID 或 `@username` |
| `label` | `TEXT` | 顯示用標籤 |
| `created_at`／`updated_at` | `TIMESTAMPTZ` | 新增／最後改標籤時間；推播依新增順序 |

資料表由 `npm run recipients` 第一次執行時建立；網站讀取時表還不存在就視同沒有收件人。

三個常見地雷：

1. **`.env` 只在啟動時讀取**，改 token 後要重開 `npm run dev`（收件人不受影響）
2. `.env.example` 說明區塊裡的範例行開頭有 `#`，是註解，改那裡不會生效 —— 要改檔案下方沒有 `#` 的那一行
3. 收件人必須**先主動對 bot 說過話**，否則 Telegram 會回 `chat not found`

正式部署時 `.env` 不會被帶上去，改用 secret（`DATABASE_URL` 見下方「登入」）：

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

推播內容（`lib/telegram.ts` 的 `buildChipReport`）：

```
📊 台指期籌碼｜2026/09/24

現貨三大法人（億元）
外資 -329.6｜投信 -128.2｜自營 +13.4
合計 -444.5 🟢

外資期貨（約當大台／口）
純日盤變化量 +85
籌碼型態 偏多 🔴
```

現貨與期貨都讀資料庫裡最新的一天。標題日期以期貨為準；證交所若落後一天，現貨那行會加註 `※2026/09/23`。任一來源取不到時只有該段顯示「尚無資料」，不影響另一段。

---

## 登入

整個網站（儀表板與所有 API）都需要登入，檢查寫在 `worker/index.ts` 最前面（`lib/auth.ts` 的 `gateRequest`）。帳號密碼自己管理，帳號與 cookie 簽章金鑰都存在 Postgres（`lib/auth-db.ts`），和籌碼資料同一個資料庫。唯一要設定的環境變數是 `DATABASE_URL`：

```bash
DATABASE_URL=postgresql://…         # Railway 上填 ${{Postgres.DATABASE_URL}}

npm run users -- add ck       # 新增帳號或改密碼（密碼問兩次、不顯示）
npm run users -- remove ck    # 刪除帳號
npm run users -- list         # 列出帳號
npm run users -- logout-all   # 換簽章金鑰，所有人最晚 5 分鐘內需重新登入
```

`auth_users`：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `username` | `TEXT PRIMARY KEY` | 英數與 `._-`，1–64 字 |
| `password_hash` | `TEXT` | `pbkdf2.<次數>.<salt>.<hash>` |
| `created_at`／`updated_at` | `TIMESTAMPTZ` | 建立／最後改密碼時間 |

`auth_settings`：目前只有一筆 `key = 'session_secret'`，是 64 字元的隨機 hex，用來簽登入 cookie。第一次有人登入時自動產生；刪掉這筆（`logout-all`）下次會再產生新的，所有既有登入隨之失效。

- 兩張表不存在時會自動建立：`npm run users` 每次執行都會先 `CREATE TABLE IF NOT EXISTS`；網站則是查詢時遇到「資料表不存在」（`42P01`）才建表並重試，所以全新的資料庫直接登入也不會出錯，平常查詢也不會多跑建表指令。`postgres.railway.internal` 只有 Railway 內部連得到，在自己電腦上執行請把 `.env` 的 `DATABASE_URL` 換成 Railway 後台的 `DATABASE_PUBLIC_URL`。
- 密碼以 PBKDF2-SHA256（100000 次，workerd 上限）加鹽雜湊，資料庫不存明碼。
- 登入後發一個 30 天有效的 HMAC 簽章 cookie（`HttpOnly; SameSite=Lax`，https 下加 `Secure`）。之後每個請求只驗簽章、不查帳號；簽章金鑰讀到後在記憶體暫存 5 分鐘，所以平常只有登入時才會連 Postgres。
- **刪除帳號只會擋下之後的登入**，已登入的裝置要等 cookie 到期；要踢掉所有人請用 `npm run users -- logout-all`，最晚 5 分鐘（金鑰暫存時間）生效。
- `DATABASE_URL` 沒設時一律擋下；Postgres 連不上且金鑰不在暫存時，網頁導向登入頁並顯示「無法連線帳號資料庫」，不會因此變成公開。
- 目前沒有登入失敗次數限制，請使用夠長的密碼（工具要求至少 8 字元）。

正式部署：

```bash
npx wrangler secret put DATABASE_URL
```

Railway 則在服務的 Variables 新增 `DATABASE_URL`，值填 `${{Postgres.DATABASE_URL}}`。

---

## 本機執行

需要 Node.js 22.13 以上。

```bash
npm install
npm run dev     # http://localhost:3000
```

## Docker

不想在本機裝 Node.js 時可用 Docker。容器內會先 `npm run build`，再用 `vite preview` 在 workerd 裡跑建置後的 Worker（`vinext start` 是純 Node 伺服器，不是 Worker 執行環境，不能用）。

```bash
docker compose up -d --build   # http://localhost:3000
docker compose logs -f         # 看伺服器紀錄
docker compose down            # 停止（資料保留）
```

- **Telegram 與登入設定**：沿用同一份 `.env`，`compose.yaml` 的 `environment` 只從 `.env` 取 `TELEGRAM_BOT_TOKEN`、`DATABASE_URL` 兩個值帶進容器（`.env` 不會被打包進映像；新增其他環境變數時要一併加進 `environment`）。改完 `.env` 要 `docker compose up -d` 重建容器才會生效，單純 `restart` 不會重讀。沒有 `.env` 也能啟動，但沒有 `DATABASE_URL` 就無法登入、讀寫籌碼資料，也無法推播。
- **資料庫**：籌碼資料存在 `DATABASE_URL` 指向的 Postgres，容器本身不存資料，`down` 或重建都不影響；和 `npm run dev` 用的 `.env` 指向同一個資料庫時，兩邊看到的是同一份。
- **改程式後**：要加 `--build` 重建映像。

### 平日自動排程

主服務容器裡背景執行的 `scripts/daily-schedule-trigger.mjs`（`Dockerfile` 的 `CMD` 與網站一起啟動，本機 Docker 與 Railway 都一樣，不需另開服務）每 5 分鐘呼叫一次 `POST /api/trading-doctor/daily-schedule`，實際判斷在 `lib/daily-schedule.ts`：

- **時段**：週一到週五、台北時間 14:50 起；週末與 14:50 前直接略過，不連外。
- **每輪只補缺的**：夜盤、日盤看資料庫有沒有當天那列；證交所則是先抓最新一天、存進 `twse_institutional_flows`（即使還是前一交易日也照存），再看資料庫有沒有今天的資料。
- **補抓前幾天**：每天第一輪（通常是 14:50）先補最近 7 天內資料庫缺的平日夜盤／日盤，一天只補一次（休市日本來就抓不到，不重複白打）。只補資料、不補發當天的報告。缺一天會讓隔天的純日盤變化量、籌碼型態與開盤推估改用更早一天當基準而算錯，所以要先補齊再抓今天。
- **三項到齊**：推播一次籌碼報告（與「傳送籌碼報告」按鈕同一份）。至少一位收件人成功就算完成；全部失敗則下一輪重試。
- **18:00 仍未到齊**（例如休市日）：推播一則「截至 18:00 仍未取得：…」通知，當天不再重試。
- 報告、補抓、缺漏通知的完成紀錄存在 `daily_schedule_jobs` 表，重複觸發不會重複寫入或重複推播。
- 看執行紀錄：每一步的明細（各項資料取得／尚未公布／失敗、補抓結果、推播成功與否、每位收件人的傳送結果）寫在主服務，與每輪呼叫 API 的回應摘要都在同一份紀錄：本機用 `docker compose logs -f taifex-chips | grep 排程`，Railway 看該服務的 Deploy Logs。都不寫略過的輪次（週末、14:50 前、當天已完成）。

## 驗證

```bash
npm test        # 先 build，再跑 tests/*.test.mjs
npm run lint
```

## 資料來源

- [期交所：區分各期貨契約－依日期](https://www.taifex.com.tw/cht/3/futContractsDate)（全日，對應下午 SOP）
- [期交所：區分各期貨契約－盤後交易時段](https://www.taifex.com.tw/cht/3/futContractsDateAh)（夜盤，對應早上 SOP）
- [證交所：三大法人買賣金額統計表](https://www.twse.com.tw/zh/trading/foreign/bfi82u.html)
