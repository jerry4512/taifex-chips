#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
LOG_FILE="$(mktemp -t taifex-chips-dev)"
WATCHER_PID=""

cleanup() {
  if [[ -n "${WATCHER_PID}" ]]; then
    kill "${WATCHER_PID}" 2>/dev/null || true
  fi
  rm -f "${LOG_FILE}"
}

trap cleanup EXIT INT TERM

cd "${PROJECT_DIR}" || {
  echo "無法進入專案資料夾：${PROJECT_DIR}"
  read -r "?按 Enter 關閉視窗..."
  exit 1
}

# Finder 啟動的 .command 不一定會帶入 Homebrew 的路徑。
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

clear
echo "========================================"
echo "  台指期籌碼｜本地啟動工具"
echo "========================================"
echo

if ! command -v npm >/dev/null 2>&1; then
  echo "找不到 npm，請先安裝 Node.js 22 或更新版本。"
  echo "下載網址：https://nodejs.org/"
  echo
  read -r "?按 Enter 關閉視窗..."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "第一次啟動，正在安裝必要套件..."
  if ! npm install; then
    echo
    echo "套件安裝失敗，請檢查網路連線後再試一次。"
    read -r "?按 Enter 關閉視窗..."
    exit 1
  fi
  echo
fi

echo "正在啟動本地伺服器，完成後會自動打開網頁..."
echo "要停止伺服器，請按 Control + C 或關閉這個視窗。"
echo

(
  for _ in {1..120}; do
    LOCAL_URL="$(grep -Eo 'http://(localhost|127\.0\.0\.1):[0-9]+' "${LOG_FILE}" | tail -n 1)"

    if [[ -n "${LOCAL_URL}" ]] && curl --silent --fail --max-time 1 "${LOCAL_URL}" >/dev/null 2>&1; then
      echo
      echo "本地網頁已啟動：${LOCAL_URL}"
      if [[ "${TAIFEX_NO_BROWSER:-0}" != "1" ]]; then
        open "${LOCAL_URL}"
      fi
      exit 0
    fi

    sleep 0.5
  done

  echo
  echo "伺服器已啟動，但未能自動取得網址；請查看上方顯示的 Local 網址。"
) &
WATCHER_PID=$!

npm run dev 2>&1 | tee "${LOG_FILE}"
SERVER_STATUS=${pipestatus[1]}

echo
if [[ ${SERVER_STATUS} -eq 0 ]]; then
  echo "本地伺服器已停止。"
else
  echo "本地伺服器異常停止（錯誤代碼：${SERVER_STATUS}）。"
fi
read -r "?按 Enter 關閉視窗..."
exit "${SERVER_STATUS}"
