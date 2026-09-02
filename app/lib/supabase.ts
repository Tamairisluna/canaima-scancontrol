import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import {
  supabaseCookieOptions,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase/config";

export const supabase = createBrowserClient(supabaseUrl, supabasePublishableKey, {
  cookieOptions: supabaseCookieOptions,
});

export const createProvisioningClient = () => createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
