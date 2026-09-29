// 產生 AUTH_USERS 的一筆設定：npm run hash-password -- 帳號
// 密碼從鍵盤輸入（不顯示），不會留在 shell 歷史紀錄裡。
import { stdin, stdout, argv, exit } from "node:process";
import { hashPassword } from "../lib/auth.ts";

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

const username = argv[2]?.trim();
if (!username || /[:,\s]/.test(username)) {
  console.error("用法：npm run hash-password -- 帳號（帳號不可含冒號、逗號或空白）");
  exit(1);
}

const password = await askHidden("密碼：");
const confirm = await askHidden("再輸入一次：");
if (!password || password !== confirm) {
  console.error("兩次密碼不一致或為空");
  exit(1);
}

console.log(`\n把下面這段加進 AUTH_USERS（多個帳號用逗號串起來）：\n${username}:${await hashPassword(password)}`);
