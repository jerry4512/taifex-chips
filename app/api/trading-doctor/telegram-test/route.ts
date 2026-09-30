import { NextResponse } from "next/server";
import { collectReportInput } from "../../../../lib/chip-report";
import {
  broadcastTelegramMessage,
  buildChipReport,
  readTelegramConfig,
  type TelegramChatTarget,
  type TelegramDeliveryResult,
  type TelegramEnv,
} from "../../../../lib/telegram";

export const dynamic = "force-dynamic";

export interface TelegramStatusResponse {
  configured: boolean;
  botTokenPresent: boolean;
  chats: TelegramChatTarget[];
  error?: string;
}

export interface TelegramTestResponse {
  sentAt: string;
  message: string;
  okCount: number;
  failedCount: number;
  results: TelegramDeliveryResult[];
}

async function telegramEnv(): Promise<TelegramEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as TelegramEnv;
}

export async function GET() {
  const env = await telegramEnv();
  const botTokenPresent = Boolean(env.TELEGRAM_BOT_TOKEN?.trim());

  try {
    const { targets } = readTelegramConfig(env);
    return NextResponse.json<TelegramStatusResponse>(
      { configured: true, botTokenPresent, chats: targets },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram 設定無法讀取";
    return NextResponse.json<TelegramStatusResponse>(
      { configured: false, botTokenPresent, chats: [], error: message },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST() {
  let token: string;
  let targets: TelegramChatTarget[];

  try {
    ({ token, targets } = readTelegramConfig(await telegramEnv()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram 設定無法讀取";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const message = buildChipReport(await collectReportInput());
  const results = await broadcastTelegramMessage(token, targets, message);
  const okCount = results.filter((result) => result.ok).length;

  return NextResponse.json<TelegramTestResponse>(
    {
      sentAt: new Date().toISOString(),
      message,
      okCount,
      failedCount: results.length - okCount,
      results,
    },
    { status: okCount > 0 ? 200 : 502 },
  );
}
