// 排程觸發器（Dockerfile 的 CMD 在同一個容器背景執行，本機 Docker 與 Railway 皆同）：每 5 分鐘（對齊 :00、:05、:10…）呼叫一次排程 API。
// 平日、14:50 之後、還有沒拿到的資料才會真的去抓，這些判斷都在伺服器端的 lib/daily-schedule.ts。
const url =
  process.env.SCHEDULE_URL ?? "http://localhost:3000/api/trading-doctor/daily-schedule";
const INTERVAL_MS = 5 * 60_000;

function timestamp() {
  return new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

async function trigger() {
  try {
    const response = await fetch(url, { method: "POST" });
    const body = await response.json().catch(() => null);
    // 非排程時段回傳 skipped，不寫紀錄以免洗版。
    if (!response.ok || body?.status !== "skipped") {
      console.log(`[${timestamp()}] ${response.status} ${JSON.stringify(body)}`);
    }
  } catch (error) {
    console.error(`[${timestamp()}] 無法連線到 ${url}：${error.message}`);
  }
}

function scheduleNext() {
  // 多等 1 秒，確保落在整 5 分鐘之後（例如 14:50:01），不會因時鐘誤差提早成 14:49:59。
  const delay = INTERVAL_MS - (Date.now() % INTERVAL_MS) + 1_000;
  setTimeout(async () => {
    await trigger();
    scheduleNext();
  }, delay);
}

console.log(`[${timestamp()}] 排程觸發器已啟動，每 5 分鐘呼叫 ${url}`);
scheduleNext();
