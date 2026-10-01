// 查看與清空籌碼資料（存在 DATABASE_URL 指向的 Postgres）：
//   npm run data -- list                     列出各資料表的日期數與日期範圍
//   npm run data -- clear spot               清空證交所三大法人
//   npm run data -- clear night              清空期交所夜盤
//   npm run data -- clear day                清空期交所日盤
//   npm run data -- clear night,day          一次清多張（逗號分隔）
//   npm run data -- clear all                三張全部清空
// 清空前會列出資料庫位置與要刪的範圍，需輸入 yes 確認；加 --yes 可跳過確認（排程或腳本用）。
// 只刪資料、保留資料表，網站不會再灌回 09/21–09/24 的種子資料；要恢復請在網頁上逐日重新取得。
// DATABASE_URL 從環境變數或 .env 讀取。postgres.railway.internal 只有 Railway 內部連得到，
// 在自己電腦上執行時請改用 Railway 後台 Postgres 的 DATABASE_PUBLIC_URL。
import { createInterface } from "node:readline/promises";
import process, { argv, env, exit, stdin, stdout } from "node:process";
import { withSql } from "../lib/auth-db.ts";
import { clearDataTables, parseDataTargets, summarizeDataTables } from "../lib/data-admin.ts";

const USAGE = "用法：npm run data -- list | clear spot|night|day|all [--yes]（可用逗號一次指定多個，如 night,day）";
const args = argv.slice(2);
const skipConfirm = args.includes("--yes");
const [command, targetArg] = args.filter((arg) => arg !== "--yes");
const targets = command === "list" ? parseDataTargets("all") : parseDataTargets(targetArg);

if (!["list", "clear"].includes(command) || !targets) {
  console.error(USAGE);
  exit(1);
}

/** 只顯示主機與資料庫名稱，不印出帳號密碼。 */
function describeDatabase(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "（DATABASE_URL 格式無法辨識）";
  }
}

function describe(summary) {
  if (!summary.exists) return `${summary.label}（${summary.table}）：資料表尚未建立`;
  if (summary.dates === 0) return `${summary.label}（${summary.table}）：沒有資料`;
  const range = summary.firstDate === summary.lastDate ? summary.firstDate : `${summary.firstDate} ～ ${summary.lastDate}`;
  return `${summary.label}（${summary.table}）：${summary.dates} 天，${range}`;
}

async function confirm(question) {
  if (!stdin.isTTY) {
    console.error("無法互動確認；確定要清空請加上 --yes");
    process.exitCode = 1;
    return false;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

try {
  await withSql(env.DATABASE_URL, async (sql) => {
    console.log(`資料庫：${describeDatabase(env.DATABASE_URL)}`);
    const summaries = await summarizeDataTables(sql, targets);
    for (const summary of summaries) console.log(`  ${describe(summary)}`);
    if (command === "list") return;

    if (summaries.every((summary) => summary.dates === 0)) {
      console.log("沒有資料需要清空");
      return;
    }
    if (!skipConfirm && !(await confirm("以上資料將永久刪除、無法復原。確定清空請輸入 yes："))) {
      console.log("已取消，沒有刪除任何資料");
      return;
    }

    const deleted = await clearDataTables(sql, targets);
    for (const summary of summaries) console.log(`已清空 ${summary.label}：刪除 ${deleted.get(summary.target) ?? 0} 列`);
  });
} catch (error) {
  console.error(`操作失敗：${error instanceof Error ? error.message : error}`);
  exit(1);
}
