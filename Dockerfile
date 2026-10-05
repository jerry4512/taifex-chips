# 台指期籌碼：以 vite preview 在 workerd 中執行建置後的 Worker，資料存在 DATABASE_URL 的 Postgres。
# workerd 需要 glibc，因此使用 Debian 版映像而非 Alpine。
FROM node:22-bookworm-slim

# workerd 對期交所、證交所與 Telegram 發 HTTPS 請求時需要系統憑證。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# vite preview 需要 vite.config.ts 用到的開發套件（vinext、@cloudflare/vite-plugin、wrangler），所以完整安裝。
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV WRANGLER_SEND_METRICS=false \
  # 讓 compose 傳入的 TELEGRAM_* 環境變數成為 Worker 的 env。
  CLOUDFLARE_INCLUDE_PROCESS_ENV=true

EXPOSE 3000

# 排程觸發器在同一個容器背景執行（每 5 分鐘打一次 localhost 的排程 API），
# Railway 只部署這個映像，不必另開付費的排程服務。
CMD ["sh", "-c", "node scripts/daily-schedule-trigger.mjs & exec npx vite preview --host 0.0.0.0 --port 3000 --strictPort"]
