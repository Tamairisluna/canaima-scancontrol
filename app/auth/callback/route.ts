import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null, origin: string) {
  if (!value) return "/";

  try {
    const destination = new URL(value, origin);
    return destination.origin === origin
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : "/";
  } catch {
    return "/";
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"), requestUrl.origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const response = NextResponse.redirect(new URL(next, requestUrl.origin));
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  }

  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("error", "auth_callback");
  return NextResponse.redirect(loginUrl);
}
