import assert from "node:assert/strict";
import test from "node:test";
import {
  checkCredentials,
  createSessionToken,
  gateRequest,
  hashPassword,
  isValidUsername,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifyPassword,
  verifySessionToken,
} from "../lib/auth.ts";

// 每次執行隨機產生，不在原始碼寫死任何 secret。
const SECRET = crypto.randomUUID() + crypto.randomUUID();

test("hashPassword avoids $ and verifies only the right password", async () => {
  const stored = await hashPassword("s3cret!");
  assert.match(stored, /^pbkdf2\.100000\.[\w-]+\.[\w-]+$/);
  assert.doesNotMatch(stored, /\$/);
  assert.equal(await verifyPassword("s3cret!", stored), true);
  assert.equal(await verifyPassword("s3cret?", stored), false);
  assert.equal(await verifyPassword("s3cret!", "pbkdf2.999999.AAAA.AAAA"), false);
  assert.equal(await verifyPassword("s3cret!", "garbage"), false);
});

test("isValidUsername allows only safe characters", () => {
  assert.equal(isValidUsername("ck.lin_01-a"), true);
  assert.equal(isValidUsername(""), false);
  assert.equal(isValidUsername("a b"), false);
  assert.equal(isValidUsername("x".repeat(65)), false);
  assert.equal(isValidUsername("ck'; DROP TABLE auth_users;--"), false);
});

test("checkCredentials rejects unknown users and wrong passwords", async () => {
  const stored = await hashPassword("正確密碼");
  assert.equal(await checkCredentials(stored, "正確密碼"), true);
  assert.equal(await checkCredentials(stored, "錯誤"), false);
  assert.equal(await checkCredentials(null, "正確密碼"), false);
});

test("session tokens expire and resist tampering", async () => {
  const now = Date.UTC(2026, 8, 29);
  const token = await createSessionToken("ck", SECRET, now);

  assert.equal(await verifySessionToken(token, SECRET, now + 1000), "ck");
  assert.equal(await verifySessionToken(token, SECRET, now + SESSION_MAX_AGE_SECONDS * 1000 + 1), null);

  const [payload, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "ck", exp: now + 10 ** 12 })).toString("base64url");
  assert.equal(await verifySessionToken(`${forged}.${signature}`, SECRET, now), null);
  assert.equal(await verifySessionToken(`${payload}.${signature}x`, SECRET, now), null);
  assert.equal(await verifySessionToken(token, `${SECRET}-rotated`, now), null);
});

test("safeNextPath only allows same-site paths", () => {
  assert.equal(safeNextPath("/?tab=1"), "/?tab=1");
  assert.equal(safeNextPath("//evil.example"), "/");
  assert.equal(safeNextPath("/\\evil.example"), "/");
  assert.equal(safeNextPath("https://evil.example"), "/");
  assert.equal(safeNextPath(null), "/");
});

test("gateRequest redirects pages, 401s APIs, and lets sessions through", async () => {
  const token = await createSessionToken("ck", SECRET);
  let secretLoads = 0;
  const loadSecret = async () => {
    secretLoads += 1;
    return SECRET;
  };

  const page = await gateRequest(new Request("http://localhost/?x=1"), loadSecret);
  assert.equal(page?.status, 302);
  assert.equal(page?.headers.get("location"), "/login?next=%2F%3Fx%3D1");

  const api = await gateRequest(new Request("http://localhost/api/trading-doctor/bfi82u"), loadSecret);
  assert.equal(api?.status, 401);
  assert.deepEqual(await api?.json(), { error: "請先登入" });
  // 沒帶 cookie 的請求不需要讀金鑰，不會連資料庫。
  assert.equal(secretLoads, 0);

  assert.equal(await gateRequest(new Request("http://localhost/login"), loadSecret), null);
  assert.equal(await gateRequest(new Request("http://localhost/assets/page.js"), loadSecret), null);

  const withCookie = () => new Request("http://localhost/", { headers: { cookie: `a=b; ${SESSION_COOKIE}=${token}` } });
  assert.equal(await gateRequest(withCookie(), loadSecret), null);
  // 金鑰換過之後，舊 cookie 就不再有效。
  assert.equal((await gateRequest(withCookie(), async () => `${SECRET}-rotated`))?.status, 302);
});

test("gateRequest fails closed when the secret cannot be loaded", async () => {
  const token = await createSessionToken("ck", SECRET);
  const cookie = `${SESSION_COOKIE}=${token}`;
  const broken = async () => {
    throw new Error("connection refused");
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const page = await gateRequest(new Request("http://localhost/", { headers: { cookie } }), broken);
    assert.equal(page?.status, 302);
    assert.equal(page?.headers.get("location"), "/login?error=db");

    const api = await gateRequest(new Request("http://localhost/api/trading-doctor/bfi82u", { headers: { cookie } }), broken);
    assert.equal(api?.status, 503);
    assert.deepEqual(await api?.json(), { error: "無法連線帳號資料庫" });
  } finally {
    console.error = originalError;
  }
});
