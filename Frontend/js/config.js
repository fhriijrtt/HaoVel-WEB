'use strict';

window.HAOVELS_CONFIG = {
  API_BASE_URL: 'https://haovels-production.up.railway.app/api',
  SUPABASE_URL: window.HAOVELS_ENV?.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: window.HAOVELS_ENV?.SUPABASE_ANON_KEY || '',
};
