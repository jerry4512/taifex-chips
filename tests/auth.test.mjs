import assert from "node:assert/strict";
import test from "node:test";
import {
  checkCredentials,
  createSessionToken,
  gateRequest,
  hashPassword,
  parseAuthUsers,
  readAuthConfig,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifyPassword,
  verifySessionToken,
} from "../lib/auth.ts";

// 每次執行隨機產生，不在原始碼寫死任何 secret。
const SECRET = crypto.randomUUID() + crypto.randomUUID();

async function makeConfig() {
  const env = { AUTH_USERS: `ck:${await hashPassword("正確密碼")}`, AUTH_SECRET: SECRET };
  return { env, config: readAuthConfig(env) };
}

test("hashPassword avoids $ and verifies only the right password", async () => {
  const stored = await hashPassword("s3cret!");
  assert.match(stored, /^pbkdf2\.100000\.[\w-]+\.[\w-]+$/);
  assert.doesNotMatch(stored, /\$/);
  assert.equal(await verifyPassword("s3cret!", stored), true);
  assert.equal(await verifyPassword("s3cret?", stored), false);
  assert.equal(await verifyPassword("s3cret!", "pbkdf2.999999.AAAA.AAAA"), false);
  assert.equal(await verifyPassword("s3cret!", "garbage"), false);
});

test("parseAuthUsers reads comma or newline separated entries", async () => {
  const hash = await hashPassword("x");
  const users = parseAuthUsers(`ck:${hash},\n  guest : ${hash} `);
  assert.deepEqual([...users.keys()], ["ck", "guest"]);
  assert.equal(parseAuthUsers("").size, 0);
  assert.throws(() => parseAuthUsers("ck:plaintext"), /AUTH_USERS 格式錯誤/);
});

test("readAuthConfig fails closed when users or secret are missing", async () => {
  const hash = await hashPassword("x");
  assert.throws(() => readAuthConfig({ AUTH_SECRET: SECRET }), /尚未設定 AUTH_USERS/);
  assert.throws(() => readAuthConfig({ AUTH_USERS: `ck:${hash}`, AUTH_SECRET: "short" }), /AUTH_SECRET/);
});

test("checkCredentials rejects unknown users and wrong passwords", async () => {
  const { config } = await makeConfig();
  assert.equal(await checkCredentials(config, "ck", "正確密碼"), true);
  assert.equal(await checkCredentials(config, "ck", "錯誤"), false);
  assert.equal(await checkCredentials(config, "nobody", "正確密碼"), false);
});

test("session tokens expire, resist tampering, and die with removed users", async () => {
  const { config } = await makeConfig();
  const now = Date.UTC(2026, 8, 29);
  const token = await createSessionToken("ck", SECRET, now);

  assert.equal(await verifySessionToken(token, config, now + 1000), "ck");
  assert.equal(await verifySessionToken(token, config, now + SESSION_MAX_AGE_SECONDS * 1000 + 1), null);

  const [payload, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "ck", exp: now + 10 ** 12 })).toString("base64url");
  assert.equal(await verifySessionToken(`${forged}.${signature}`, config, now), null);
  assert.equal(await verifySessionToken(`${payload}.${signature}x`, config, now), null);
  assert.equal(await verifySessionToken(token, { ...config, secret: `${SECRET}-rotated` }, now), null);
  assert.equal(await verifySessionToken(token, { ...config, users: new Map() }, now), null);
});

test("safeNextPath only allows same-site paths", () => {
  assert.equal(safeNextPath("/?tab=1"), "/?tab=1");
  assert.equal(safeNextPath("//evil.example"), "/");
  assert.equal(safeNextPath("/\\evil.example"), "/");
  assert.equal(safeNextPath("https://evil.example"), "/");
  assert.equal(safeNextPath(null), "/");
});

test("gateRequest redirects pages, 401s APIs, and lets sessions through", async () => {
  const { env } = await makeConfig();
  const token = await createSessionToken("ck", SECRET);

  const page = await gateRequest(new Request("http://localhost/?x=1"), env);
  assert.equal(page?.status, 302);
  assert.equal(page?.headers.get("location"), "/login?next=%2F%3Fx%3D1");

  const api = await gateRequest(new Request("http://localhost/api/trading-doctor/bfi82u"), env);
  assert.equal(api?.status, 401);
  assert.deepEqual(await api?.json(), { error: "請先登入" });

  assert.equal(await gateRequest(new Request("http://localhost/login"), env), null);
  assert.equal(await gateRequest(new Request("http://localhost/assets/page.js"), env), null);

  const withCookie = new Request("http://localhost/", { headers: { cookie: `a=b; ${SESSION_COOKIE}=${token}` } });
  assert.equal(await gateRequest(withCookie, env), null);
  // 設定被拿掉時，舊 cookie 也不再有效。
  assert.equal((await gateRequest(withCookie, {}))?.status, 302);
});
