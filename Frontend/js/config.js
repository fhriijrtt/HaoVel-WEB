'use strict';

window.HAOVELS_CONFIG = {
  // local development
  // production: https://haovels-production.up.railway.app/api
  API_BASE_URL: 'haovel-web-production.up.railway.app',
  SUPABASE_URL: window.HAOVELS_ENV?.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: window.HAOVELS_ENV?.SUPABASE_ANON_KEY || '',
};
