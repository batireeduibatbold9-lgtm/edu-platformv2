import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

if (SUPABASE_URL.startsWith("YOUR_") || SUPABASE_ANON_KEY.startsWith("YOUR_")) {
  console.warn("Set Supabase URL and anon key in js/config.js");
}

export const sb = window.supabase.createClient(
  https://cfscrmcmyrbcuwmscyeo.supabase.co,
  sb_publishable_oO1yzy3LYsj5TkgfVGNcFQ_OuC9TpNW,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);
