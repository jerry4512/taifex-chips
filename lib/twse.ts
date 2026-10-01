const BFI82U_URL = "https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json";

export type TwseInstitutionName = "外資及陸資" | "投信" | "自營商" | "三大法人合計";

export interface TwseInstitutionFlow {
  name: TwseInstitutionName;
  buy: number;
  sell: number;
  difference: number;
}

export interface TwseBfi82uResponse {
  date: string;
  generatedAt: string;
  unit: "元";
  source: string;
  data: TwseInstitutionFlow[];
}

interface TwseRawResponse {
  stat?: string;
  date?: string;
  data?: unknown;
}

function parseAmount(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("證交所 BFI82U 金額格式不正確");
  }
  const normalized = String(value).replaceAll(",", "").trim();
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error("證交所 BFI82U 金額格式不正確");
  }
  return Number.parseInt(normalized, 10);
}

function formatDate(value: string): string {
  if (!/^\d{8}$/.test(value)) throw new Error("證交所 BFI82U 日期格式不正確");
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/** 證交所 BFI82U 的一列原始金額；item 為證交所原名，例如「自營商(自行買賣)」。 */
export interface TwseRawFlow {
  item: string;
  buy: number;
  sell: number;
}

export interface TwseBfi82uRaw {
  date: string;
  rows: TwseRawFlow[];
}

function addRows(name: TwseInstitutionName, rows: TwseRawFlow[]): TwseInstitutionFlow {
  const buy = rows.reduce((sum, row) => sum + row.buy, 0);
  const sell = rows.reduce((sum, row) => sum + row.sell, 0);
  return { name, buy, sell, difference: buy - sell };
}

/** 解析證交所回應，保留每一列的原始買進、賣出金額（買賣差額由兩者相減即得，不保留）。 */
export function parseBfi82uRaw(payload: TwseRawResponse): TwseBfi82uRaw {
  if (payload.stat !== "OK" || !payload.date || !Array.isArray(payload.data)) {
    throw new Error("證交所暫無最新三大法人資料");
  }

  const rows: TwseRawFlow[] = [];
  for (const rawRow of payload.data) {
    if (!Array.isArray(rawRow) || rawRow.length < 4 || typeof rawRow[0] !== "string") continue;
    rows.push({ item: rawRow[0], buy: parseAmount(rawRow[1]), sell: parseAmount(rawRow[2]) });
  }

  const raw = { date: formatDate(payload.date), rows };
  combineBfi82u(raw);
  return raw;
}

/** 把原始列合併成畫面與報告用的四類法人；自營商 = 自行買賣 + 避險。 */
export function combineBfi82u({ date, rows }: TwseBfi82uRaw): Omit<TwseBfi82uResponse, "generatedAt"> {
  const byItem = new Map(rows.map((row) => [row.item, row]));
  const dealerOwn = byItem.get("自營商(自行買賣)");
  const dealerHedge = byItem.get("自營商(避險)");
  const trust = byItem.get("投信");
  const foreign = byItem.get("外資及陸資(不含外資自營商)");
  const total = byItem.get("合計");
  if (!dealerOwn || !dealerHedge || !trust || !foreign || !total) {
    throw new Error("證交所 BFI82U 資料欄位不完整");
  }

  return {
    date,
    unit: "元",
    source: BFI82U_URL,
    data: [
      addRows("外資及陸資", [foreign]),
      addRows("投信", [trust]),
      addRows("自營商", [dealerOwn, dealerHedge]),
      addRows("三大法人合計", [total]),
    ],
  };
}

export function parseBfi82u(payload: TwseRawResponse): Omit<TwseBfi82uResponse, "generatedAt"> {
  return combineBfi82u(parseBfi82uRaw(payload));
}

/** 向證交所抓最新一個交易日的原始金額；BFI82U 只提供最新一天。 */
export async function fetchLatestBfi82u(fetcher: typeof fetch = fetch): Promise<TwseBfi82uRaw> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher(BFI82U_URL, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "zh-TW,zh;q=0.9",
        "User-Agent": "taifex-chips/0.1 (+https://github.com/jerry4512/taifex-chips)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`證交所回應 ${response.status}`);
    return parseBfi82uRaw((await response.json()) as TwseRawResponse);
  } finally {
    clearTimeout(timeout);
  }
}
