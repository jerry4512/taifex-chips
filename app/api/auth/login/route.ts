import { NextResponse } from "next/server";
import {
  checkCredentials,
  createSessionToken,
  isSecureRequest,
  readAuthConfig,
  safeNextPath,
  sessionCookie,
  type AuthConfig,
  type AuthEnv,
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

/** 登入頁是純 HTML 表單，成功或失敗都用 303 轉回頁面，不需要前端 JS。 */
function redirectTo(request: Request, path: string, cookie?: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  if (cookie) response.headers.append("Set-Cookie", cookie);
  return response;
}

function loginPath(error: "invalid" | "config", next: string) {
  const params = new URLSearchParams({ error });
  if (next !== "/") params.set("next", next);
  return `/login?${params}`;
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const username = String(form?.get("username") ?? "").trim();
  const password = String(form?.get("password") ?? "");
  const next = safeNextPath(String(form?.get("next") ?? ""));

  let config: AuthConfig;
  try {
    const { env } = await import("cloudflare:workers");
    config = readAuthConfig(env as unknown as AuthEnv);
  } catch {
    return redirectTo(request, loginPath("config", next));
  }

  if (!username || !password || !(await checkCredentials(config, username, password))) {
    return redirectTo(request, loginPath("invalid", next));
  }

  const token = await createSessionToken(username, config.secret);
  return redirectTo(request, next, sessionCookie(token, isSecureRequest(request)));
}
