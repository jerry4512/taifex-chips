import { NextResponse } from "next/server";
import { clearSessionCookie, isSecureRequest } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.append("Set-Cookie", clearSessionCookie(isSecureRequest(request)));
  return response;
}
