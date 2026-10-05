import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSessionToken, SESSION_COOKIE } from "../lib/auth.ts";

// 每次執行隨機產生，不在原始碼寫死任何 secret；正式環境的金鑰存在 Postgres。
const SESSION_SECRET = crypto.randomUUID() + crypto.randomUUID();
const sessionCookie = `${SESSION_COOKIE}=${await createSessionToken("tester", SESSION_SECRET)}`;

async function render(path = "/", { cookie = sessionCookie } = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { createWorker } = await import(workerUrl.href);
  const worker = createWorker({ loadSecret: async () => SESSION_SECRET });

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html", ...(cookie ? { cookie } : {}) } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server renders the futures positioning page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>台指期籌碼｜夜盤推估與日盤未平倉<\/title>/i);
  assert.match(html, /Telegram 籌碼推播/);
  assert.match(html, /早上：夜盤推估 SOP/);
  assert.match(html, /下午：日盤未平倉買賣超/);
  assert.match(html, /最新三大法人買賣金額/);
  assert.match(html, /官方約當淨 OI/);
  assert.match(html, /開盤預估約當淨 OI/);
  assert.match(html, /夜盤約當買賣超/);
  assert.match(html, /2026\/09\/21 因缺少前一交易日基準/);
  // 開啟頁面會自動讀資料庫，伺服器端先渲染成載入中，而不是「沒有資料」。
  assert.match(html, /正在讀取資料庫的證交所資料/);
  assert.match(html, /正在讀取資料庫的夜盤資料/);
  assert.match(html, /正在讀取資料庫的日盤資料/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
  assert.match(html, /action="\/api\/auth\/logout"/);
});

test("requires login before rendering the dashboard", async () => {
  const blocked = await render("/", { cookie: null });
  assert.equal(blocked.status, 302);
  assert.equal(blocked.headers.get("location"), "/login");

  const login = await render("/login?error=invalid&next=%2F%3Fa%3D1", { cookie: null });
  assert.equal(login.status, 200);
  const html = await login.text();
  assert.match(html, /action="\/api\/auth\/login"/);
  assert.match(html, /帳號或密碼錯誤/);
  assert.match(html, /placeholder="請輸入帳號"/);
  assert.match(html, /placeholder="請輸入密碼"/);
  assert.match(html, /name="next" value="\/\?a=1"/);
  assert.doesNotMatch(html, /早上：夜盤推估 SOP/);
});

test("starter preview is removed", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("offers a date-specific database acquisition flow", async () => {
  const [page, route, afterHoursRoute, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/trading-doctor/taifex-futures/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/api/trading-doctor/taifex-futures-after-hours/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /type="date"/);
  assert.match(page, /取得資料/);
  assert.match(page, /取得夜盤資料/);
  assert.match(page, /id="spot-date"/);
  assert.match(page, /取得證交所資料/);
  assert.doesNotMatch(page, /重新整理/);
  assert.match(route, /export async function POST/);
  assert.match(afterHoursRoute, /export async function GET/);
  assert.match(afterHoursRoute, /export async function POST/);
  assert.match(afterHoursRoute, /futContractsDateAh|TAIFEX_AFTER_HOURS_SOURCE/);
  // 籌碼資料改存 Postgres（DATABASE_URL），不再綁定 D1。
  assert.equal(JSON.parse(hosting).d1, null);
});

test("documents the Telegram environment variables without committing secrets", async () => {
  const [example, gitignore, envTypes] = await Promise.all([
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../cloudflare-env.d.ts", import.meta.url), "utf8"),
  ]);

  assert.match(example, /^TELEGRAM_BOT_TOKEN=$/m);
  assert.match(gitignore, /^\.env\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  assert.match(envTypes, /TELEGRAM_BOT_TOKEN\?: string;/);
  assert.doesNotMatch(envTypes, /TELEGRAM_CHAT_IDS/);
});
