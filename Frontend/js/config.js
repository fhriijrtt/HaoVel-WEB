'use strict';

window.HAOVELS_CONFIG = {
  // local development
  // production: https://haovels-production.up.railway.app/api
  API_BASE_URL: 'http://localhost:3000/api',
  SUPABASE_URL: window.HAOVELS_ENV?.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: window.HAOVELS_ENV?.SUPABASE_ANON_KEY || '',
};
