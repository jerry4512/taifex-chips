// 管理登入帳號（存在 DATABASE_URL 指向的 Postgres）：
//   npm run users -- add 帳號      新增帳號，或幫既有帳號改密碼
//   npm run users -- remove 帳號   刪除帳號
//   npm run users -- list          列出所有帳號
//   npm run users -- logout-all    換新的 cookie 簽章金鑰，所有人最晚 5 分鐘內被登出
// DATABASE_URL 從環境變數或 .env 讀取。postgres.railway.internal 只有 Railway 內部連得到，
// 在自己電腦上執行時請改用 Railway 後台 Postgres 的 DATABASE_PUBLIC_URL。
// 密碼從鍵盤輸入（不顯示），不會留在 shell 歷史紀錄裡。
import { argv, env, exit, stdin, stdout } from "node:process";
import { hashPassword, isValidUsername } from "../lib/auth.ts";
import { deleteUser, ensureAuthTables, listUsers, rotateSessionSecret, upsertUser, withSql } from "../lib/auth-db.ts";

function askHidden(question) {
  return new Promise((resolve) => {
    stdout.write(question);
    let input = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    // 貼上時一次會收到多個字元，逐字處理。
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") exit(130);
        if (char === "\r" || char === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(input);
          return;
        }
        input = char === "\u007f" || char === "\b" ? input.slice(0, -1) : input + char;
      }
    };
    stdin.on("data", onData);
  });
}

const USAGE = "用法：npm run users -- add 帳號 | remove 帳號 | list | logout-all";
const [command, username] = argv.slice(2);
const needsUsername = command === "add" || command === "remove";

if (!["add", "remove", "list", "logout-all"].includes(command) || (needsUsername && !username)) {
  console.error(USAGE);
  exit(1);
}
if (needsUsername && !isValidUsername(username)) {
  console.error("帳號只能用英文字母、數字與 . _ -，長度 1–64");
  exit(1);
}

let passwordHash;
if (command === "add") {
  const password = await askHidden("密碼：");
  const confirm = await askHidden("再輸入一次：");
  if (password.length < 8 || password !== confirm) {
    console.error("兩次密碼不一致，或少於 8 個字元");
    exit(1);
  }
  passwordHash = await hashPassword(password);
}

try {
  await withSql(env.DATABASE_URL, async (sql) => {
    await ensureAuthTables(sql);
    if (command === "add") {
      const created = await upsertUser(sql, username, passwordHash);
      console.log(created ? `已新增帳號 ${username}` : `已更新 ${username} 的密碼`);
    } else if (command === "remove") {
      console.log((await deleteUser(sql, username)) ? `已刪除帳號 ${username}` : `找不到帳號 ${username}`);
    } else if (command === "logout-all") {
      await rotateSessionSecret(sql);
      console.log("已更換簽章金鑰，所有裝置最晚 5 分鐘內需要重新登入");
    } else {
      const users = await listUsers(sql);
      if (users.length === 0) console.log("目前沒有任何帳號");
      for (const user of users) console.log(`${user.username}\t建立 ${user.createdAt.toISOString()}\t更新 ${user.updatedAt.toISOString()}`);
    }
  });
} catch (error) {
  console.error(`操作失敗：${error instanceof Error ? error.message : error}`);
  exit(1);
}
