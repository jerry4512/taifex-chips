/**
 * 登入帳號與 cookie 簽章金鑰存在 Postgres（Railway），與籌碼資料（lib/futures-db.ts）同一個資料庫。
 * Worker 不能跨請求共用 TCP 連線，所以每次都開一條、用完即關；
 * 金鑰讀到後暫存在記憶體，平常只有登入時才會連資料庫。資料表不存在時會自動建立。
 */
import postgres from "postgres";

export const USERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS auth_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export const SETTINGS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS auth_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

const SESSION_SECRET_KEY = "session_secret";
/** 金鑰暫存多久後重讀；刪掉資料庫裡的金鑰後，最晚這麼久所有人會被登出。 */
export const SESSION_SECRET_CACHE_MS = 5 * 60 * 1000;

export interface AuthUserRow {
  username: string;
  createdAt: Date;
  updatedAt: Date;
}

type Sql = postgres.Sql;

export async function withSql<T>(databaseUrl: string | undefined, run: (sql: Sql) => Promise<T>): Promise<T> {
  if (!databaseUrl?.trim()) throw new Error("尚未設定 DATABASE_URL，無法連線 Postgres");
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });
  try {
    return await run(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function ensureAuthTables(sql: Pick<Sql, "unsafe">): Promise<void> {
  await sql.unsafe(USERS_TABLE_SQL);
  await sql.unsafe(SETTINGS_TABLE_SQL);
}

/** Postgres 的 undefined_table 錯誤碼。 */
const UNDEFINED_TABLE = "42P01";

/**
 * 先直接查；資料表不存在（全新資料庫、或表被刪掉）時才建表並重試一次，
 * 平常的查詢不會多跑 CREATE TABLE。
 */
export async function withAuthTables<T>(sql: Pick<Sql, "unsafe">, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== UNDEFINED_TABLE) throw error;
    await ensureAuthTables(sql);
    return run();
  }
}

export async function findPasswordHash(sql: Sql, username: string): Promise<string | null> {
  const rows = await withAuthTables(sql, () => sql<{ password_hash: string }[]>`
    SELECT password_hash FROM auth_users WHERE username = ${username}
  `);
  return rows[0]?.password_hash ?? null;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 沒有金鑰就產生一把；多個請求同時搶著建立時，以先寫入的為準。 */
export async function getOrCreateSessionSecret(sql: Sql): Promise<string> {
  return withAuthTables(sql, async () => {
    await sql`
      INSERT INTO auth_settings (key, value) VALUES (${SESSION_SECRET_KEY}, ${randomSecret()})
      ON CONFLICT (key) DO NOTHING
    `;
    const rows = await sql<{ value: string }[]>`SELECT value FROM auth_settings WHERE key = ${SESSION_SECRET_KEY}`;
    return rows[0].value;
  });
}

/** 刪掉金鑰：下次讀取會產生新的一把，所有既有登入隨之失效。 */
export async function rotateSessionSecret(sql: Sql): Promise<void> {
  await ensureAuthTables(sql);
  await sql`DELETE FROM auth_settings WHERE key = ${SESSION_SECRET_KEY}`;
}

let cachedSecret: { value: string; expiresAt: number } | null = null;

/** Worker 用：暫存金鑰字串（不是連線，可以跨請求保留），過期才重連資料庫。 */
export async function loadSessionSecret(databaseUrl: string | undefined, now = Date.now()): Promise<string> {
  if (cachedSecret && cachedSecret.expiresAt > now) return cachedSecret.value;
  const value = await withSql(databaseUrl, getOrCreateSessionSecret);
  cachedSecret = { value, expiresAt: now + SESSION_SECRET_CACHE_MS };
  return value;
}

/** 帳號已存在時改密碼。回傳 true 表示新建立。 */
export async function upsertUser(sql: Sql, username: string, passwordHash: string): Promise<boolean> {
  const rows = await sql<{ inserted: boolean }[]>`
    INSERT INTO auth_users (username, password_hash) VALUES (${username}, ${passwordHash})
    ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()
    RETURNING (xmax = 0) AS inserted
  `;
  return rows[0].inserted;
}

export async function deleteUser(sql: Sql, username: string): Promise<boolean> {
  const rows = await sql`DELETE FROM auth_users WHERE username = ${username} RETURNING username`;
  return rows.length > 0;
}

export async function listUsers(sql: Sql): Promise<AuthUserRow[]> {
  const rows = await sql<{ username: string; created_at: Date; updated_at: Date }[]>`
    SELECT username, created_at, updated_at FROM auth_users ORDER BY username
  `;
  return rows.map((row) => ({ username: row.username, createdAt: row.created_at, updatedAt: row.updated_at }));
}
