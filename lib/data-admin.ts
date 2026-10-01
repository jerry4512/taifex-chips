/**
 * `npm run data` 用：查看與清空籌碼資料表。
 * 不 import 其他 lib 模組，讓 scripts 與測試能用 Node 原生 type stripping 直接載入；
 * 資料表名稱與 lib/futures-db.ts 的 FUTURES_TABLES_SQL 一致，改名時兩邊要同步。
 */
import type postgres from "postgres";

export const DATA_TARGETS = {
  spot: { table: "twse_institutional_flows", label: "證交所三大法人" },
  night: { table: "nightly_futures_positions", label: "期交所夜盤" },
  day: { table: "daily_futures_positions", label: "期交所日盤" },
} as const;

export type DataTarget = keyof typeof DATA_TARGETS;

const ALL_TARGETS = Object.keys(DATA_TARGETS) as DataTarget[];

function isDataTarget(value: string): value is DataTarget {
  return Object.hasOwn(DATA_TARGETS, value);
}

/** 解析 `spot`、`night,day`、`all` 這類參數；有任何不認得的名稱就回傳 null。 */
export function parseDataTargets(value: string | undefined): DataTarget[] | null {
  if (!value) return null;
  if (value === "all") return [...ALL_TARGETS];
  const names = value.split(",").map((name) => name.trim()).filter(Boolean);
  if (names.length === 0 || !names.every(isDataTarget)) return null;
  // 去重並固定成 spot → night → day 的順序，顯示時比較好對照。
  return ALL_TARGETS.filter((target) => names.includes(target));
}

export interface DataTableSummary {
  target: DataTarget;
  label: string;
  table: string;
  /** 資料表還沒建立時為 false（網站第一次讀寫時才會自動建表）。 */
  exists: boolean;
  dates: number;
  firstDate: string | null;
  lastDate: string | null;
}

type Sql = postgres.Sql;

async function tableExists(sql: Sql, table: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`SELECT to_regclass(${table}) IS NOT NULL AS exists`;
  return rows[0].exists;
}

/** 列出每張表有幾個日期與日期範圍（證交所一天有多列，所以算日期數而不是列數）。 */
export async function summarizeDataTables(sql: Sql, targets: readonly DataTarget[]): Promise<DataTableSummary[]> {
  const summaries: DataTableSummary[] = [];
  for (const target of targets) {
    const { table, label } = DATA_TARGETS[target];
    if (!(await tableExists(sql, table))) {
      summaries.push({ target, label, table, exists: false, dates: 0, firstDate: null, lastDate: null });
      continue;
    }
    const [row] = await sql<{ dates: string; first_date: string | null; last_date: string | null }[]>`
      SELECT count(DISTINCT date) AS dates, min(date) AS first_date, max(date) AS last_date FROM ${sql(table)}
    `;
    summaries.push({
      target,
      label,
      table,
      exists: true,
      dates: Number(row.dates),
      firstDate: row.first_date,
      lastDate: row.last_date,
    });
  }
  return summaries;
}

/**
 * 在同一個交易裡清空指定資料表（DELETE，保留資料表本身），任一張失敗就全部不刪。
 * 資料表保留著，網站不會重新灌入 09/21–09/24 的種子資料；回傳每張表刪掉的列數。
 */
export async function clearDataTables(sql: Sql, targets: readonly DataTarget[]): Promise<Map<DataTarget, number>> {
  const deleted = new Map<DataTarget, number>();
  await sql.begin(async (transaction) => {
    for (const target of targets) {
      const { table } = DATA_TARGETS[target];
      if (!(await tableExists(transaction as unknown as Sql, table))) {
        deleted.set(target, 0);
        continue;
      }
      const result = await transaction`DELETE FROM ${transaction(table)}`;
      deleted.set(target, result.count);
    }
  });
  return deleted;
}
