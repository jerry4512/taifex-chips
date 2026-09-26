---
paths:
  - "lib/taifex.ts"
  - "lib/twse.ts"
  - "lib/futures-db.ts"
  - "tests/taifex.test.mjs"
  - "tests/twse.test.mjs"
---

# 籌碼計算與資料來源規則

- 公式以 README「計算規則」與試算表 `期貨.xlsx`「外資籌碼統計」為準；改公式前先確認試算表欄位（B–M）對應，不要自行發明指標。
- 約當大台：`大台 + excelRound(小台 / 4) + excelRound(微台 / 20)`，各商品**先各自**取整再相加。一律用 `excelRound`（遠離零），禁用 `Math.round` / `toFixed`。
- 交易日歸屬：D-1 15:00 至 D 05:00 的夜盤屬於交易日 D。開盤推估的基準是「交易日 D 之前最後一筆」官方約當淨 OI（`baselineOfficialOi`），不是日曆上的前一天。
- 沒有前日基準時（首日 2026/09/21、或中間缺資料）衍生值回傳 `null`，不要補 0。
- 期交所 HTML 解析（`parseForeignNetPositions`）：全日報表每列 12 個數字、淨未平倉在 index 10；夜盤報表 6 個、index 4。期交所改版時先用實際 HTML 更新測試 fixture 再改解析器。
- 非交易日／尚未公布時會丟出以「期交所資料未完整揭露」開頭的錯誤，`loadDate` 依此前綴回傳 `null`；改訊息文字要同步改判斷。
- 對外抓取的函式都接受可注入的 `fetcher` 參數，測試用假 fetch，不要在測試中真的連線期交所或證交所。
- 日期一律 `YYYY-MM-DD` 字串、以台北時區（`taipeiToday`）判斷「今天」；週末由 `tradingDateCandidates` 排除，國定假日則靠期交所回傳空資料。
