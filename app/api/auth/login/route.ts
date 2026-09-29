import { NextResponse } from "next/server";
import {
  checkCredentials,
  createSessionToken,
  isSecureRequest,
  isValidUsername,
  safeNextPath,
  sessionCookie,
  type AuthEnv,
} from "../../../../lib/auth";
import { findPasswordHash, loadSessionSecret, withSql } from "../../../../lib/auth-db";

export const dynamic = "force-dynamic";

/** 登入頁是純 HTML 表單，成功或失敗都用 303 轉回頁面，不需要前端 JS。 */
function redirectTo(request: Request, path: string, cookie?: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  if (cookie) response.headers.append("Set-Cookie", cookie);
  return response;
}

function loginPath(error: "invalid" | "config" | "db", next: string) {
  const params = new URLSearchParams({ error });
  if (next !== "/") params.set("next", next);
  return `/login?${params}`;
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const username = String(form?.get("username") ?? "").trim();
  const password = String(form?.get("password") ?? "");
  const next = safeNextPath(String(form?.get("next") ?? ""));

  const { env } = await import("cloudflare:workers");
  const authEnv = env as unknown as AuthEnv;

  if (!authEnv.DATABASE_URL?.trim()) return redirectTo(request, loginPath("config", next));

  // 格式不符的帳號不可能存在，直接當成帳密錯誤，不必連資料庫。
  let stored: string | null = null;
  if (isValidUsername(username)) {
    try {
      stored = await withSql(authEnv.DATABASE_URL, (sql) => findPasswordHash(sql, username));
    } catch (error) {
      console.error("讀取登入帳號失敗", error);
      return redirectTo(request, loginPath("db", next));
    }
  }

  if (!password || !(await checkCredentials(stored, password))) {
    return redirectTo(request, loginPath("invalid", next));
  }

  let secret: string;
  try {
    secret = await loadSessionSecret(authEnv.DATABASE_URL);
  } catch (error) {
    console.error("讀取登入金鑰失敗", error);
    return redirectTo(request, loginPath("db", next));
  }

  const token = await createSessionToken(username, secret);
  return redirectTo(request, next, sessionCookie(token, isSecureRequest(request)));
}
