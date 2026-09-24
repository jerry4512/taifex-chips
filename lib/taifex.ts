const TAIFEX_ORIGIN = "https://www.taifex.com.tw";

export const DEFAULT_START_DATE = "2026-09-21";
export const MAX_RANGE_DAYS = 31;

export const TAIFEX_PRODUCTS = [
  "臺股期貨",
  "小型臺指期貨",
  "微型臺指期貨",
] as const;

export type TaifexProduct = (typeof TAIFEX_PRODUCTS)[number];
export type ChipInterpretation = "偏多" | "偏空" | "無顯著變化";

export interface ForeignNetPositions {
  臺股期貨: number;
  小型臺指期貨: number;
  微型臺指期貨: number;
}

export interface TaifexFuturesRow {
  date: string;
  txNetOpenInterest: number;
  mtxNetOpenInterest: number;
  tmfNetOpenInterest: number;
  officialEquivalentNetOi: number;
  totalPositionChange: number | null;
  nightEquivalentNet: number | null;
  pureDayChange: number | null;
  interpretation: ChipInterpretation | null;
}

export interface TaifexFuturesResponse {
  startDate: string;
  endDate: string;
  generatedAt: string;
  sources: {
    fullDay: string;
    night: string;
  };
  data: TaifexFuturesRow[];
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
      const normalized = entity.toLowerCase();
      if (normalized.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
      }
      if (normalized.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
      }
      return named[normalized] ?? `&${entity};`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function parseInteger(value: string): number | null {
  const normalized = value.replaceAll(",", "").trim();
  if (!/^-?\d+$/.test(normalized)) return null;
  return Number.parseInt(normalized, 10);
}

function extractFirstTableRows(html: string): string[][] {
  const table = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0];
  if (!table) return [];

  return Array.from(table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), (row) =>
    Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi), (cell) =>
      decodeHtml(cell[1]),
    ),
  );
}

export function parseForeignNetPositions(
  html: string,
  report: "full-day" | "night",
): ForeignNetPositions {
  const results = new Map<TaifexProduct, number>();
  const fullProductRowLength = report === "full-day" ? 15 : 9;
  const continuationRowLength = report === "full-day" ? 13 : 7;
  const netCountIndex = report === "full-day" ? 10 : 4;
  let currentProduct: string | null = null;

  for (const cells of extractFirstTableRows(html)) {
    let trader: string;
    let figures: string[];

    if (cells.length === fullProductRowLength) {
      currentProduct = cells[1];
      trader = cells[2];
      figures = cells.slice(3);
    } else if (cells.length === continuationRowLength && currentProduct) {
      trader = cells[0];
      figures = cells.slice(1);
    } else {
      continue;
    }

    if (!TAIFEX_PRODUCTS.includes(currentProduct as TaifexProduct) || trader !== "外資") {
      continue;
    }

    const net = parseInteger(figures[netCountIndex] ?? "");
    if (net !== null) {
      results.set(currentProduct as TaifexProduct, net);
    }
  }

  const missing = TAIFEX_PRODUCTS.filter((product) => !results.has(product));
  if (missing.length > 0) {
    throw new Error(`期交所資料未完整揭露：${missing.join("、")}`);
  }

  return Object.fromEntries(results) as unknown as ForeignNetPositions;
}

export function excelRound(value: number): number {
  return Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
}

export function equivalentTxContracts(values: ForeignNetPositions): number {
  return (
    values.臺股期貨 +
    excelRound(values.小型臺指期貨 / 4) +
    excelRound(values.微型臺指期貨 / 20)
  );
}

export function interpretChipChange(value: number): ChipInterpretation {
  if (value > 0) return "偏多";
  if (value < 0) return "偏空";
  return "無顯著變化";
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function taipeiToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function tradingDateCandidates(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) throw new Error("日期格式必須為 YYYY-MM-DD");
  if (start > end) throw new Error("開始日期不可晚於結束日期");

  const calendarDays = Math.floor((end.valueOf() - start.valueOf()) / 86_400_000) + 1;
  if (calendarDays > MAX_RANGE_DAYS) {
    throw new Error(`單次查詢最多 ${MAX_RANGE_DAYS} 天`);
  }

  const dates: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(formatIsoDate(cursor));
  }
  return dates;
}

function taifexUrl(path: "futContractsDate" | "futContractsDateAh", date: string): string {
  const url = new URL(`/cht/3/${path}`, TAIFEX_ORIGIN);
  url.searchParams.set("queryDate", date.replaceAll("-", "/"));
  return url.toString();
}

async function fetchTaifexReport(
  path: "futContractsDate" | "futContractsDateAh",
  date: string,
  fetcher: typeof fetch,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetcher(taifexUrl(path, date), {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-TW,zh;q=0.9",
        "User-Agent": "taifex-chips/0.1 (+https://github.com/jerry4512/taifex-chips)",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`期交所回應 ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadDate(
  date: string,
  fetcher: typeof fetch,
): Promise<
  | { date: string; fullDay: ForeignNetPositions; night: ForeignNetPositions }
  | null
> {
  try {
    const [fullDayHtml, nightHtml] = await Promise.all([
      fetchTaifexReport("futContractsDate", date, fetcher),
      fetchTaifexReport("futContractsDateAh", date, fetcher),
    ]);
    return {
      date,
      fullDay: parseForeignNetPositions(fullDayHtml, "full-day"),
      night: parseForeignNetPositions(nightHtml, "night"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知錯誤";
    if (message.startsWith("期交所資料未完整揭露")) return null;
    throw error;
  }
}

export async function getTaifexFutures(
  startDate = DEFAULT_START_DATE,
  endDate = taipeiToday(),
  fetcher: typeof fetch = fetch,
): Promise<TaifexFuturesResponse> {
  const today = taipeiToday();
  if (endDate > today) throw new Error("結束日期不可晚於今天");

  const candidates = tradingDateCandidates(startDate, endDate);
  const loaded = await Promise.all(candidates.map((date) => loadDate(date, fetcher)));
  const tradingDays = loaded.filter((item) => item !== null);

  let previousOfficialOi: number | null = null;
  const data = tradingDays.map(({ date, fullDay, night }) => {
    const officialEquivalentNetOi = equivalentTxContracts(fullDay);
    const nightEquivalentNet = equivalentTxContracts(night);
    const totalPositionChange =
      previousOfficialOi === null ? null : officialEquivalentNetOi - previousOfficialOi;
    const pureDayChange =
      totalPositionChange === null ? null : totalPositionChange - nightEquivalentNet;

    const row: TaifexFuturesRow = {
      date,
      txNetOpenInterest: fullDay.臺股期貨,
      mtxNetOpenInterest: fullDay.小型臺指期貨,
      tmfNetOpenInterest: fullDay.微型臺指期貨,
      officialEquivalentNetOi,
      totalPositionChange,
      nightEquivalentNet,
      pureDayChange,
      interpretation: pureDayChange === null ? null : interpretChipChange(pureDayChange),
    };
    previousOfficialOi = officialEquivalentNetOi;
    return row;
  });

  return {
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    sources: {
      fullDay: `${TAIFEX_ORIGIN}/cht/3/futContractsDate`,
      night: `${TAIFEX_ORIGIN}/cht/3/futContractsDateAh`,
    },
    data,
  };
}
