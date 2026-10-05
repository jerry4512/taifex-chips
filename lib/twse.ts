export const BFI82U_URL = "https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json";

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

/** 資料庫裡某一天合併後的四類法人。 */
export interface TwseBfi82uDay {
  date: string;
  flows: TwseInstitutionFlow[];
}

/** GET /api/trading-doctor/bfi82u：資料庫裡所有日期，依日期由舊到新。 */
export interface TwseBfi82uListResponse {
  startDate: string;
  endDate: string;
  generatedAt: string;
  unit: "元";
  source: string;
  data: TwseBfi82uDay[];
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

/** 把資料庫讀回的多天原始列依日期分組並合併，日期由舊到新。 */
export function groupBfi82uDays(rows: readonly (TwseRawFlow & { date: string })[]): TwseBfi82uDay[] {
  const byDate = new Map<string, TwseRawFlow[]>();
  for (const { date, item, buy, sell } of rows) {
    const list = byDate.get(date) ?? [];
    list.push({ item, buy, sell });
    byDate.set(date, list);
  }
  return [...byDate.keys()]
    .sort()
    .map((date) => ({ date, flows: combineBfi82u({ date, rows: byDate.get(date) ?? [] }).data }));
}

export function parseBfi82u(payload: TwseRawResponse): Omit<TwseBfi82uResponse, "generatedAt"> {
  return combineBfi82u(parseBfi82uRaw(payload));
}

/** 指定日期（YYYY-MM-DD）時帶 type=day&dayDate，不指定則由證交所回最新一個交易日。 */
export function bfi82uUrl(date?: string): string {
  if (date === undefined) return BFI82U_URL;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("請選擇有效日期");
  return `${BFI82U_URL}&type=day&dayDate=${date.replaceAll("-", "")}`;
}

/** 向證交所抓最新一個交易日的原始金額。 */
export function fetchLatestBfi82u(fetcher: typeof fetch = fetch): Promise<TwseBfi82uRaw> {
  return fetchBfi82u(undefined, fetcher);
}

/** 向證交所抓指定日期的原始金額；非交易日或尚未公布時丟出錯誤，不回傳其他日期的資料。 */
export async function fetchBfi82u(
  date: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<TwseBfi82uRaw> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    // 證交所前面的 CDN 會快取同一個網址，資料公布前查過的「查無資料」會一直被回傳；加時間戳讓每次都拿到最新回應。
    const response = await fetcher(`${bfi82uUrl(date)}&_=${Date.now()}`, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "zh-TW,zh;q=0.9",
        "User-Agent": "taifex-chips/0.1 (+https://github.com/jerry4512/taifex-chips)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`證交所回應 ${response.status}`);
    const payload = (await response.json()) as TwseRawResponse;
    if (date === undefined) return parseBfi82uRaw(payload);

    const noData = "該日期沒有證交所資料，請確認是否為交易日或資料是否已公布";
    if (payload.stat !== "OK") throw new Error(noData);
    const raw = parseBfi82uRaw(payload);
    if (raw.date !== date) throw new Error(noData);
    return raw;
  } finally {
    clearTimeout(timeout);
  }
}
