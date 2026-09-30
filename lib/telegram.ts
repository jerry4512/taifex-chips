const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 10_000;

/** `.env` 讀得到的 Telegram 設定。 */
export interface TelegramEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_IDS?: string;
}

export interface TelegramChatTarget {
  /** 給人看的標籤，未設定時等同 chatId。 */
  label: string;
  chatId: string;
}

export interface TelegramDeliveryResult extends TelegramChatTarget {
  ok: boolean;
  error?: string;
}

/** 個人／群組為數字 id，公開頻道可用 @username。 */
function isValidChatId(value: string): boolean {
  return /^-?\d+$/.test(value) || /^@[A-Za-z][A-Za-z0-9_]{3,}$/.test(value);
}

/**
 * 解析 TELEGRAM_CHAT_IDS。
 * 以「,」或換行分隔多個對象，每筆可寫成 `標籤:chatId` 或只寫 `chatId`；
 * 標籤本身可以包含冒號，所以用最後一個冒號切分。
 */
export function parseChatTargets(raw: string | undefined): TelegramChatTarget[] {
  const entries = (raw ?? "")
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("#"));

  const targets: TelegramChatTarget[] = [];
  const invalid: string[] = [];

  for (const entry of entries) {
    const separator = entry.lastIndexOf(":");
    const label = separator === -1 ? "" : entry.slice(0, separator).trim();
    const chatId = (separator === -1 ? entry : entry.slice(separator + 1)).trim();

    if (!isValidChatId(chatId)) {
      invalid.push(entry);
      continue;
    }
    targets.push({ label: label || chatId, chatId });
  }

  if (invalid.length > 0) {
    throw new Error(
      `TELEGRAM_CHAT_IDS 格式錯誤：${invalid.join("、")}（每筆請寫成「標籤:chatId」或只寫 chatId）`,
    );
  }

  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.chatId)) return false;
    seen.add(target.chatId);
    return true;
  });
}

/** 讀出設定；缺少 token 或收件人時丟出可直接顯示給使用者的錯誤。 */
export function readTelegramConfig(env: TelegramEnv): {
  token: string;
  targets: TelegramChatTarget[];
} {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  if (!token) {
    throw new Error("尚未設定 TELEGRAM_BOT_TOKEN，請在 .env 填入 BotFather 給的 token");
  }

  const targets = parseChatTargets(env.TELEGRAM_CHAT_IDS);
  if (targets.length === 0) {
    throw new Error("尚未設定 TELEGRAM_CHAT_IDS，請在 .env 填入至少一個 chat ID");
  }

  return { token, targets };
}

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 報告需要的最小資料，缺哪一段就只略過那一段。 */
export interface ChipReportInput {
  spot: {
    date: string;
    flows: readonly { name: string; difference: number }[];
  } | null;
  futures: {
    date: string;
    pureDayChange: number | null;
    interpretation: string | null;
  } | null;
}

/** 台股習慣：正值紅、負值綠。 */
function toneDot(value: number): string {
  if (value > 0) return "🔴";
  if (value < 0) return "🟢";
  return "⚪";
}

function signed(value: number, fractionDigits = 0): string {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return (
    prefix +
    Math.abs(value).toLocaleString("zh-TW", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
  );
}

/** 元 → 億元，取小數一位。 */
function inHundredMillion(value: number): string {
  return signed(value / 100_000_000, 1);
}

function slashDate(value: string): string {
  return value.replaceAll("-", "/");
}

function findFlow(
  flows: readonly { name: string; difference: number }[],
  name: string,
): number | null {
  return flows.find((flow) => flow.name === name)?.difference ?? null;
}

function spotSection(spot: ChipReportInput["spot"], headlineDate: string): string[] {
  if (!spot) return ["現貨三大法人（億元）", "尚無資料"];

  const foreign = findFlow(spot.flows, "外資及陸資");
  const trust = findFlow(spot.flows, "投信");
  const dealer = findFlow(spot.flows, "自營商");
  const total = findFlow(spot.flows, "三大法人合計");
  if (foreign === null || trust === null || dealer === null || total === null) {
    return ["現貨三大法人（億元）", "尚無資料"];
  }

  // 證交所與期交所的最新日期可能不同步，不同就標出來。
  const heading =
    spot.date === headlineDate
      ? "現貨三大法人（億元）"
      : `現貨三大法人（億元）※${slashDate(spot.date)}`;

  return [
    heading,
    `外資 ${inHundredMillion(foreign)}｜投信 ${inHundredMillion(trust)}｜自營 ${inHundredMillion(dealer)}`,
    `合計 ${inHundredMillion(total)} ${toneDot(total)}`,
  ];
}

function futuresSection(futures: ChipReportInput["futures"]): string[] {
  const heading = "外資期貨（約當大台／口）";
  if (!futures || futures.pureDayChange === null) {
    return [heading, "純日盤變化量 尚無資料"];
  }

  return [
    heading,
    `純日盤變化量 ${signed(futures.pureDayChange)}`,
    `籌碼型態 ${futures.interpretation ?? "—"} ${toneDot(futures.pureDayChange)}`,
  ];
}

/** 組出要推播的籌碼報告；標題日期以期貨為準，沒有期貨資料時退回今天。 */
export function buildChipReport(input: ChipReportInput, now = new Date()): string {
  const headlineDate = input.futures?.date ?? taipeiDateFormatter.format(now);

  return [
    `📊 台指期籌碼｜${slashDate(headlineDate)}`,
    "",
    ...spotSection(input.spot, headlineDate),
    "",
    ...futuresSection(input.futures),
  ].join("\n");
}

/** 排程到放棄時間仍有資料沒到齊時的通知，例如休市日。 */
export function buildMissingDataNotice(
  date: string,
  missingLabels: readonly string[],
  giveUpTime: string,
): string {
  return [
    `⚠️ 台指期籌碼｜${slashDate(date)}`,
    "",
    `截至 ${giveUpTime} 仍未取得：${missingLabels.join("、")}`,
    "今日不推播籌碼報告，請確認是否為休市日或資料延遲公布。",
  ].join("\n");
}

async function callSendMessage(
  token: string,
  chatId: string,
  text: string,
  fetcher: typeof fetch,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(`${TELEGRAM_API_ORIGIN}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;

    if (!payload?.ok) {
      // Telegram 的 description 不含 token，可安全顯示。
      throw new Error(payload?.description ?? `Telegram 回應 ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** 對每個收件人各送一則，單一失敗不影響其他人。 */
export async function broadcastTelegramMessage(
  token: string,
  targets: readonly TelegramChatTarget[],
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<TelegramDeliveryResult[]> {
  return Promise.all(
    targets.map(async (target) => {
      try {
        await callSendMessage(token, target.chatId, text, fetcher);
        return { ...target, ok: true };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.name === "AbortError"
              ? "連線逾時"
              : error.message
            : "未知錯誤";
        return { ...target, ok: false, error: message };
      }
    }),
  );
}
