import assert from "node:assert/strict";
import test from "node:test";
import { SETTINGS_TABLE_SQL, USERS_TABLE_SQL, withAuthTables } from "../lib/auth-db.ts";

/** 只記錄 DDL，不連資料庫。 */
function fakeSql() {
  const executed = [];
  return { executed, unsafe: async (query) => executed.push(query) };
}

test("withAuthTables runs the query directly when the tables exist", async () => {
  const sql = fakeSql();
  assert.equal(await withAuthTables(sql, async () => "ok"), "ok");
  assert.deepEqual(sql.executed, []);
});

test("withAuthTables creates missing tables and retries once", async () => {
  const sql = fakeSql();
  let attempts = 0;
  const result = await withAuthTables(sql, async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('relation "auth_users" does not exist'), { code: "42P01" });
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  assert.deepEqual(sql.executed, [USERS_TABLE_SQL, SETTINGS_TABLE_SQL]);
});

test("withAuthTables rethrows other database errors without creating tables", async () => {
  const sql = fakeSql();
  const refused = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
  await assert.rejects(withAuthTables(sql, async () => { throw refused; }), refused);
  assert.deepEqual(sql.executed, []);
});
