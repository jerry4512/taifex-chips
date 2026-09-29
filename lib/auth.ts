/**
 * 帳號密碼登入：帳號清單放在環境變數 `AUTH_USERS`（只存 PBKDF2 雜湊），
 * 登入後發一個以 `AUTH_SECRET` 做 HMAC 簽章的 cookie，不需要資料庫。
 * 只用 WebCrypto，Worker 與 Node（測試、雜湊產生工具）都能跑。
 */

export interface AuthEnv {
  AUTH_USERS?: string;
  AUTH_SECRET?: string;
}

export interface AuthConfig {
  /** 帳號 → 儲存的密碼雜湊 */
  users: Map<string, string>;
  secret: string;
}

export const SESSION_COOKIE = "taifex_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** workerd 的 PBKDF2 上限是 100000 次。 */
export const PBKDF2_ITERATIONS = 100_000;
const MIN_SECRET_LENGTH = 32;
const HASH_PREFIX = "pbkdf2";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * 產生 `pbkdf2.<次數>.<salt>.<hash>`。刻意不用 `$` 分隔，
 * 避免 .env、docker compose、Railway 把 `$xxx` 當成變數展開。
 */
export async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<string> {
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return [HASH_PREFIX, PBKDF2_ITERATIONS, toBase64Url(salt), toBase64Url(hash)].join(".");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, iterationsText, saltText, hashText] = stored.split(".");
  const iterations = Number(iterationsText);
  const salt = fromBase64Url(saltText ?? "");
  const expected = fromBase64Url(hashText ?? "");
  if (prefix !== HASH_PREFIX || !Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS || !salt || !expected) {
    return false;
  }
  return constantTimeEqual(await pbkdf2(password, salt, iterations), expected);
}

/** 逗號或換行分隔，每筆 `帳號:雜湊`。 */
export function parseAuthUsers(raw: string | undefined): Map<string, string> {
  const users = new Map<string, string>();
  for (const entry of (raw ?? "").split(/[,\n]/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.lastIndexOf(":");
    const username = trimmed.slice(0, separator).trim();
    const hash = trimmed.slice(separator + 1).trim();
    if (separator <= 0 || !hash.startsWith(`${HASH_PREFIX}.`)) {
      throw new Error(`AUTH_USERS 格式錯誤：「${trimmed.slice(0, 20)}」應為「帳號:pbkdf2.…」，請用 npm run hash-password 產生`);
    }
    users.set(username, hash);
  }
  return users;
}

export function readAuthConfig(env: AuthEnv): AuthConfig {
  const users = parseAuthUsers(env.AUTH_USERS);
  if (users.size === 0) throw new Error("尚未設定 AUTH_USERS，無法登入");
  const secret = env.AUTH_SECRET?.trim() ?? "";
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`AUTH_SECRET 未設定或少於 ${MIN_SECRET_LENGTH} 個字元`);
  return { users, secret };
}

/** 帳號不存在時仍跑一次 PBKDF2，避免從回應時間猜出哪些帳號存在。 */
const DUMMY_HASH = `${HASH_PREFIX}.${PBKDF2_ITERATIONS}.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

export async function checkCredentials(config: AuthConfig, username: string, password: string): Promise<boolean> {
  const stored = config.users.get(username);
  const ok = await verifyPassword(password, stored ?? DUMMY_HASH);
  return ok && stored !== undefined;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSessionToken(username: string, secret: string, now = Date.now()): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ u: username, exp: now + SESSION_MAX_AGE_SECONDS * 1000 })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** 簽章正確、未過期、且帳號仍在 AUTH_USERS 裡才算有效；回傳帳號。 */
export async function verifySessionToken(token: string, config: AuthConfig, now = Date.now()): Promise<string | null> {
  const [payload, signatureText, extra] = token.split(".");
  const signature = fromBase64Url(signatureText ?? "");
  if (!payload || !signature || extra !== undefined) return null;

  const valid = await crypto.subtle.verify("HMAC", await hmacKey(config.secret), signature as BufferSource, encoder.encode(payload));
  if (!valid) return null;

  try {
    const bytes = fromBase64Url(payload);
    const { u, exp } = JSON.parse(new TextDecoder().decode(bytes ?? new Uint8Array())) as { u?: unknown; exp?: unknown };
    if (typeof u !== "string" || typeof exp !== "number" || exp <= now || !config.users.has(u)) return null;
    return u;
  } catch {
    return null;
  }
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Railway 在前面做 TLS，Worker 看到的是 http，要看 x-forwarded-proto。 */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  return (forwarded ?? new URL(request.url).protocol.replace(":", "")) === "https";
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** 只接受站內路徑，避免 `?next=//evil.example` 被拿來轉址。 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/favicon.svg", "/og.png", "/og-dark.png"]);

/** 登入頁本身與它需要的靜態檔不擋，其他一律要登入。 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/assets/");
}

/**
 * Worker 入口呼叫：已登入或公開路徑回 null 放行；否則網頁導向 /login、API 回 401。
 * 設定缺漏時一律擋下（fail closed），不會因為忘了設 secret 就變成公開。
 */
export async function gateRequest(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (isPublicPath(url.pathname)) return null;

  let config: AuthConfig | null = null;
  try {
    config = readAuthConfig(env);
  } catch {
    config = null;
  }

  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (config && token && (await verifySessionToken(token, config))) return null;

  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "請先登入" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const loginUrl = new URL("/login", url);
  const next = `${url.pathname}${url.search}`;
  if (next !== "/") loginUrl.searchParams.set("next", next);
  return new Response(null, { status: 302, headers: { Location: `${loginUrl.pathname}${loginUrl.search}`, "Cache-Control": "no-store" } });
}
