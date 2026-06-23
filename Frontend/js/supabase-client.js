(() => {
  'use strict';

const supabaseUrl = window.HAOVELS_CONFIG?.SUPABASE_URL || '';
const supabaseAnonKey = window.HAOVELS_CONFIG?.SUPABASE_ANON_KEY || '';

window.HaovelsSupabase = null;

if (supabaseUrl && supabaseAnonKey && window.supabase?.createClient) {
  window.HaovelsSupabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
})();
