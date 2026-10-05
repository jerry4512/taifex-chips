/**
 * 籌碼資料存在 Postgres（與登入帳號、Telegram 收件人同一個 DATABASE_URL）。
 * Worker 不能跨請求共用 TCP 連線，每次呼叫都經 withSql 開一條、用完即關。
 * 資料表不存在（全新資料庫）時才建表、灌入種子資料並重試，平常查詢不會多跑建表指令。
 */
import type postgres from "postgres";
import { withSql } from "./auth-db";
import type { DailyJob } from "./daily-schedule";
import type {
  ForeignNetPositions,
  TaifexAfterHoursRow,
  TaifexFuturesRow,
} from "./taifex";
import type { TwseBfi82uDay, TwseBfi82uRaw, TwseBfi82uResponse } from "./twse";
import { combineBfi82u, groupBfi82uDays } from "./twse";
import {
  equivalentTxContracts,
  estimateOpenEquivalentNetOi,
  interpretChipChange,
} from "./taifex";

interface StoredFuturesPosition {
  date: string;
  tx_net_open_interest: number;
  mtx_net_open_interest: number;
  tmf_net_open_interest: number;
  night_equivalent_net: number;
}

interface StoredNightlyPosition {
  date: string;
  tx_night_net: number;
  mtx_night_net: number;
  tmf_night_net: number;
}

const initialRows: Array<StoredFuturesPosition & { collected_at: string }> = [
  {
    date: "2026-09-21",
    tx_net_open_interest: -74081,
    mtx_net_open_interest: 5667,
    tmf_net_open_interest: 13703,
    night_equivalent_net: -2192,
    collected_at: "2026-09-21T08:00:00.000Z",
  },
  {
    date: "2026-09-22",
    tx_net_open_interest: -75568,
    mtx_net_open_interest: 3156,
    tmf_net_open_interest: 2682,
    night_equivalent_net: 229,
    collected_at: "2026-09-22T08:00:00.000Z",
  },
  {
    date: "2026-09-23",
    tx_net_open_interest: -76084,
    mtx_net_open_interest: 2752,
    tmf_net_open_interest: 2821,
    night_equivalent_net: -53,
    collected_at: "2026-09-23T08:00:00.000Z",
  },
  {
    date: "2026-09-24",
    tx_net_open_interest: -77031,
    mtx_net_open_interest: -876,
    tmf_net_open_interest: -3273,
    night_equivalent_net: -2244,
    collected_at: "2026-09-24T08:00:00.000Z",
  },
];

const nightlyInitialRows: Array<StoredNightlyPosition & { collected_at: string }> = [
  {
    date: "2026-09-21",
    tx_night_net: -1196,
    mtx_night_net: -2746,
    tmf_night_net: -6177,
    collected_at: "2026-09-21T00:30:00.000Z",
  },
  {
    date: "2026-09-22",
    tx_night_net: 255,
    mtx_night_net: 5,
    tmf_night_net: -547,
    collected_at: "2026-09-22T00:30:00.000Z",
  },
  {
    date: "2026-09-23",
    tx_night_net: 203,
    mtx_night_net: -1324,
    tmf_night_net: 1497,
    collected_at: "2026-09-23T00:30:00.000Z",
  },
  {
    date: "2026-09-24",
    tx_night_net: -910,
    mtx_night_net: -3274,
    tmf_night_net: -10301,
    collected_at: "2026-09-24T00:30:00.000Z",
  },
];

export const FUTURES_TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS daily_futures_positions (
    date TEXT PRIMARY KEY,
    tx_net_open_interest INTEGER NOT NULL,
    mtx_net_open_interest INTEGER NOT NULL,
    tmf_net_open_interest INTEGER NOT NULL,
    night_equivalent_net INTEGER NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS nightly_futures_positions (
    date TEXT PRIMARY KEY,
    tx_night_net INTEGER NOT NULL,
    mtx_night_net INTEGER NOT NULL,
    tmf_night_net INTEGER NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS twse_institutional_flows (
    date TEXT NOT NULL,
    item TEXT NOT NULL,
    buy BIGINT NOT NULL,
    sell BIGINT NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (date, item)
  )`,
  `CREATE TABLE IF NOT EXISTS daily_schedule_jobs (
    date TEXT NOT NULL,
    job TEXT NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (date, job)
  )`,
];

/** Postgres 的 undefined_table 錯誤碼。 */
const UNDEFINED_TABLE = "42P01";

type Sql = postgres.Sql;

async function tableExists(sql: Sql, table: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`SELECT to_regclass(${table}) IS NOT NULL AS exists`;
  return rows[0].exists;
}

/**
 * 種子資料只灌進這次新建的表：任一張表缺少都會走到這裡，
 * 不能把用 `npm run data -- clear` 清空過的日盤／夜盤又灌回去。
 */
async function createSchema(sql: Sql): Promise<void> {
  const seedDaily = !(await tableExists(sql, "daily_futures_positions"));
  const seedNightly = !(await tableExists(sql, "nightly_futures_positions"));
  for (const statement of FUTURES_TABLES_SQL) await sql.unsafe(statement);

  for (const row of seedDaily ? initialRows : []) {
    await sql`
      INSERT INTO daily_futures_positions (
        date,
        tx_net_open_interest,
        mtx_net_open_interest,
        tmf_net_open_interest,
        night_equivalent_net,
        collected_at,
        updated_at
      ) VALUES (
        ${row.date},
        ${row.tx_net_open_interest},
        ${row.mtx_net_open_interest},
        ${row.tmf_net_open_interest},
        ${row.night_equivalent_net},
        ${row.collected_at},
        ${row.collected_at}
      )
      ON CONFLICT (date) DO NOTHING
    `;
  }

  for (const row of seedNightly ? nightlyInitialRows : []) {
    await sql`
      INSERT INTO nightly_futures_positions (
        date,
        tx_night_net,
        mtx_night_net,
        tmf_night_net,
        collected_at,
        updated_at
      ) VALUES (
        ${row.date},
        ${row.tx_night_net},
        ${row.mtx_night_net},
        ${row.tmf_night_net},
        ${row.collected_at},
        ${row.collected_at}
      )
      ON CONFLICT (date) DO NOTHING
    `;
  }
}

/** 取得連線一律經過這裡：先直接查，遇到資料表不存在才建表並重試一次。 */
async function withDatabase<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  const { env } = await import("cloudflare:workers");
  return withSql(env.DATABASE_URL, async (sql) => {
    try {
      return await run(sql);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== UNDEFINED_TABLE) throw error;
      await createSchema(sql);
      return run(sql);
    }
  });
}

export async function saveFuturesPosition(row: TaifexFuturesRow): Promise<void> {
  await withDatabase(
    (sql) => sql`
      INSERT INTO daily_futures_positions (
        date,
        tx_net_open_interest,
        mtx_net_open_interest,
        tmf_net_open_interest,
        night_equivalent_net
      ) VALUES (
        ${row.date},
        ${row.txNetOpenInterest},
        ${row.mtxNetOpenInterest},
        ${row.tmfNetOpenInterest},
        ${row.nightEquivalentNet ?? 0}
      )
      ON CONFLICT (date) DO UPDATE SET
        tx_net_open_interest = EXCLUDED.tx_net_open_interest,
        mtx_net_open_interest = EXCLUDED.mtx_net_open_interest,
        tmf_net_open_interest = EXCLUDED.tmf_net_open_interest,
        night_equivalent_net = EXCLUDED.night_equivalent_net,
        updated_at = now()
    `,
  );
}

function selectFuturesPositions(sql: Sql) {
  return sql<StoredFuturesPosition[]>`
    SELECT
      date,
      tx_net_open_interest,
      mtx_net_open_interest,
      tmf_net_open_interest,
      night_equivalent_net
    FROM daily_futures_positions
    ORDER BY date ASC
  `;
}

function toFuturesRows(storedRows: readonly StoredFuturesPosition[]): TaifexFuturesRow[] {
  let previousOfficialOi: number | null = null;
  return storedRows.map((stored) => {
    const officialEquivalentNetOi = equivalentTxContracts({
      臺股期貨: stored.tx_net_open_interest,
      小型臺指期貨: stored.mtx_net_open_interest,
      微型臺指期貨: stored.tmf_net_open_interest,
    });
    const totalPositionChange =
      previousOfficialOi === null ? null : officialEquivalentNetOi - previousOfficialOi;
    const pureDayChange =
      totalPositionChange === null
        ? null
        : totalPositionChange - stored.night_equivalent_net;

    previousOfficialOi = officialEquivalentNetOi;
    return {
      date: stored.date,
      txNetOpenInterest: stored.tx_net_open_interest,
      mtxNetOpenInterest: stored.mtx_net_open_interest,
      tmfNetOpenInterest: stored.tmf_net_open_interest,
      officialEquivalentNetOi,
      totalPositionChange,
      nightEquivalentNet: stored.night_equivalent_net,
      pureDayChange,
      interpretation: pureDayChange === null ? null : interpretChipChange(pureDayChange),
    };
  });
}

export async function listFuturesPositions(): Promise<TaifexFuturesRow[]> {
  return toFuturesRows(await withDatabase(selectFuturesPositions));
}

export async function saveNightlyPosition(
  date: string,
  positions: ForeignNetPositions,
): Promise<void> {
  await withDatabase(
    (sql) => sql`
      INSERT INTO nightly_futures_positions (
        date,
        tx_night_net,
        mtx_night_net,
        tmf_night_net
      ) VALUES (
        ${date},
        ${positions.臺股期貨},
        ${positions.小型臺指期貨},
        ${positions.微型臺指期貨}
      )
      ON CONFLICT (date) DO UPDATE SET
        tx_night_net = EXCLUDED.tx_night_net,
        mtx_night_net = EXCLUDED.mtx_night_net,
        tmf_night_net = EXCLUDED.tmf_night_net,
        updated_at = now()
    `,
  );
}

/** 取交易日 date 之前最後一個已公布的官方約當淨 OI，作為開盤推估基準。 */
function baselineOfficialOi(
  dailyRows: readonly TaifexFuturesRow[],
  date: string,
): number | null {
  let baseline: number | null = null;
  for (const row of dailyRows) {
    if (row.date >= date) break;
    baseline = row.officialEquivalentNetOi;
  }
  return baseline;
}

export async function listNightlyPositions(): Promise<TaifexAfterHoursRow[]> {
  // 同一條連線依序查兩張表，避免一次請求開兩條連線。
  const [storedDaily, stored] = await withDatabase(async (sql) => [
    await selectFuturesPositions(sql),
    await sql<StoredNightlyPosition[]>`
      SELECT
        date,
        tx_night_net,
        mtx_night_net,
        tmf_night_net
      FROM nightly_futures_positions
      ORDER BY date ASC
    `,
  ] as const);
  const dailyRows = toFuturesRows(storedDaily);

  return stored.map((row) => {
    const nightEquivalentNet = equivalentTxContracts({
      臺股期貨: row.tx_night_net,
      小型臺指期貨: row.mtx_night_net,
      微型臺指期貨: row.tmf_night_net,
    });
    const previousOfficialEquivalentNetOi = baselineOfficialOi(dailyRows, row.date);

    return {
      date: row.date,
      txNightNet: row.tx_night_net,
      mtxNightNet: row.mtx_night_net,
      tmfNightNet: row.tmf_night_net,
      nightEquivalentNet,
      previousOfficialEquivalentNetOi,
      estimatedOpenEquivalentNetOi: estimateOpenEquivalentNetOi(
        previousOfficialEquivalentNetOi,
        nightEquivalentNet,
      ),
    };
  });
}

/** 證交所每列原始金額整批寫入；重抓同一天即覆蓋更正，collected_at 保留首次寫入時間。 */
export async function saveTwseInstitutionalFlows(raw: TwseBfi82uRaw): Promise<void> {
  const rows = raw.rows.map((row) => ({ date: raw.date, item: row.item, buy: row.buy, sell: row.sell }));
  await withDatabase(
    (sql) => sql`
      INSERT INTO twse_institutional_flows ${sql(rows, "date", "item", "buy", "sell")}
      ON CONFLICT (date, item) DO UPDATE SET
        buy = EXCLUDED.buy,
        sell = EXCLUDED.sell,
        updated_at = now()
    `,
  );
}

/** 讀最新一個交易日並合併成四類法人；還沒存過任何一天時回傳 null。 */
export async function latestTwseInstitutionalFlows(): Promise<TwseBfi82uResponse | null> {
  // BIGINT 由 postgres.js 以字串回傳；金額遠小於 2^53，轉回 number 不失真。
  const stored = await withDatabase(
    (sql) => sql<{ date: string; item: string; buy: string; sell: string }[]>`
      SELECT date, item, buy, sell
      FROM twse_institutional_flows
      WHERE date = (SELECT max(date) FROM twse_institutional_flows)
    `,
  );
  if (stored.length === 0) return null;

  return {
    ...combineBfi82u({
      date: stored[0].date,
      rows: stored.map((row) => ({ item: row.item, buy: Number(row.buy), sell: Number(row.sell) })),
    }),
    generatedAt: new Date().toISOString(),
  };
}

/** 讀資料庫裡所有日期並各自合併成四類法人，日期由舊到新。 */
export async function listTwseInstitutionalFlows(): Promise<TwseBfi82uDay[]> {
  // BIGINT 由 postgres.js 以字串回傳；金額遠小於 2^53，轉回 number 不失真。
  const stored = await withDatabase(
    (sql) => sql<{ date: string; item: string; buy: string; sell: string }[]>`
      SELECT date, item, buy, sell FROM twse_institutional_flows ORDER BY date
    `,
  );
  return groupBfi82uDays(
    stored.map((row) => ({ date: row.date, item: row.item, buy: Number(row.buy), sell: Number(row.sell) })),
  );
}

/** 夜盤、日盤、證交所看原始資料表有沒有當天的資料；其餘看排程完成紀錄。 */
export async function isDailyJobDone(date: string, job: DailyJob): Promise<boolean> {
  const rows = await withDatabase((sql) =>
    job === "night"
      ? sql`SELECT 1 FROM nightly_futures_positions WHERE date = ${date}`
      : job === "day"
        ? sql`SELECT 1 FROM daily_futures_positions WHERE date = ${date}`
        : job === "spot"
          ? sql`SELECT 1 FROM twse_institutional_flows WHERE date = ${date} LIMIT 1`
          : sql`SELECT 1 FROM daily_schedule_jobs WHERE date = ${date} AND job = ${job}`,
  );
  return rows.length > 0;
}

export async function markDailyJobDone(date: string, job: DailyJob): Promise<void> {
  await withDatabase(
    (sql) => sql`
      INSERT INTO daily_schedule_jobs (date, job) VALUES (${date}, ${job})
      ON CONFLICT (date, job) DO NOTHING
    `,
  );
}
