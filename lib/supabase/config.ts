export const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://wmewkfkriihwaxqpeecs.supabase.co";

export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_6NPFFfre2RXZgCtcfCOPBw_jDTX212i";

export const supabaseCookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
