import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  supabaseCookieOptions,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase/config";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookieOptions: supabaseCookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The root proxy refreshes
          // the session and writes the cookies before rendering instead.
        }
      },
    },
  });
}
