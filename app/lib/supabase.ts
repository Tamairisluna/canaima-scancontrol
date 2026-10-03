import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://wmewkfkriihwaxqpeecs.supabase.co";

const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_6NPFFfre2RXZgCtcfCOPBw_jDTX212i";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const createProvisioningClient = () => createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

// Public store directory must not inherit an expired session from this device.
let registrationDirectoryClient: typeof supabase | undefined;
export const getRegistrationDirectoryClient = () => registrationDirectoryClient ??= createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storageKey: "scancontrol-registration-directory",
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
