# 台指期籌碼

以臺灣期貨交易所三大法人資料追蹤外資台指期籌碼。目前完成「下午：日盤未平倉買賣超」，資料自 2026/09/21 起。

## 已完成

- `GET /api/trading-doctor/taifex-futures`
- 取得臺股期貨、小型臺指期貨、微型臺指期貨的外資未平倉多空淨額
- 依契約乘數換算約當大台：大台 + 小台 ÷ 4 + 微台 ÷ 20
- 計算官方約當淨 OI 日變化、扣除夜盤後的純日盤變化量
- 依純日盤變化判讀偏多、偏空或無顯著變化
- 2026/09/21 因沒有前一日基準，變化量與籌碼解讀為空值

## 本機執行

需要 Node.js 22.13 以上版本。

```bash
npm install
npm run dev
```

預設 API 查詢 2026/09/21 至台北當日，也可以指定日期：

```text
/api/trading-doctor/taifex-futures?startDate=2026-09-21&endDate=2026-09-24
```

單次查詢最多 31 個日曆日。

## 驗證

```bash
npm test
```

## 資料來源

- [期交所：區分各期貨契約－依日期](https://www.taifex.com.tw/cht/3/futContractsDate)
- [期交所：區分各期貨契約－夜盤](https://www.taifex.com.tw/cht/3/futContractsDateAh)
