import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  supabaseCookieOptions,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase/config";

const PUBLIC_PATHS = new Set(["/login", "/instalar", "/auth/callback", "/sw.js"]);
const SESSION_CACHE_HEADERS = ["cache-control", "expires", "pragma"] as const;

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/instalar/");
}

function safeNextPath(value: string | null, request: NextRequest) {
  if (!value) return "/";

  try {
    const destination = new URL(value, request.url);
    if (destination.origin !== request.nextUrl.origin) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}

function redirectWithSession(
  request: NextRequest,
  sessionResponse: NextResponse,
  pathname: string,
) {
  const destination = new URL(pathname, request.url);
  const redirectResponse = NextResponse.redirect(destination);

  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  SESSION_CACHE_HEADERS.forEach((header) => {
    const value = sessionResponse.headers.get(header);
    if (value) redirectResponse.headers.set(header, value);
  });

  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookieOptions: supabaseCookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          supabaseResponse.headers.set(name, value);
        });
      },
    },
  });

  // Keep this immediately after createServerClient. getClaims verifies the
  // signed JWT and refreshes an expired session before any route is rendered.
  const { data, error } = await supabase.auth.getClaims();
  const isAuthenticated = !error && typeof data?.claims?.sub === "string";
  const { pathname } = request.nextUrl;

  if (!isAuthenticated && !isPublicPath(pathname)) {
    const next = `${pathname}${request.nextUrl.search}`;
    const loginUrl = new URL("/login", request.url);
    if (next !== "/") loginUrl.searchParams.set("next", next);
    return redirectWithSession(request, supabaseResponse, loginUrl.toString());
  }

  if (isAuthenticated && pathname === "/login") {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"), request);
    return redirectWithSession(request, supabaseResponse, next);
  }

  return supabaseResponse;
}
