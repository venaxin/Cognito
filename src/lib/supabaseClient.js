// Lightweight client for frontend usage (CRA uses REACT_APP_* env vars)
// Make sure to set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY

// We keep this ESM-style import for CRA bundling
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
