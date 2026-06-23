(() => {
  'use strict';

const authState = {
  ready: false,
  user: null,
  profile: null,
  listeners: new Set(),
};

const getUserMeta = (user) => {
  const meta = user?.user_metadata || {};
  return {
    username: meta.name || meta.full_name || meta.user_name || user?.email?.split('@')[0] || 'User',
    avatar_url: meta.avatar_url || meta.picture || '',
  };
};

const notifyAuthListeners = () => {
  authState.listeners.forEach((listener) => listener({ ...authState }));
};

const ensureProfile = async (user) => {
  const supabase = window.HaovelsSupabase;
  if (!supabase || !user) return null;

  const meta = getUserMeta(user);
  const payload = {
    id: user.id,
    username: meta.username,
    avatar_url: meta.avatar_url,
  };

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('[auth] profile sync failed:', error.message);
    return payload;
  }
  return data;
};

const setSessionUser = async (session) => {
  authState.user = session?.user || null;
  authState.profile = authState.user ? await ensureProfile(authState.user) : null;
  authState.ready = true;
  notifyAuthListeners();
};

const initAuth = async () => {
  const supabase = window.HaovelsSupabase;
  if (!supabase) {
    authState.ready = true;
    notifyAuthListeners();
    return { ...authState };
  }

  const { data } = await supabase.auth.getSession();
  await setSessionUser(data?.session || null);

  supabase.auth.onAuthStateChange((_event, session) => {
    setSessionUser(session);
  });

  return { ...authState };
};

const loginWithGoogle = async () => {
  const supabase = window.HaovelsSupabase;
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) throw error;
};

const logout = async () => {
  const supabase = window.HaovelsSupabase;
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

window.HaovelsAuth = {
  init: initAuth,
  loginWithGoogle,
  logout,
  onChange(listener) {
    authState.listeners.add(listener);
    listener({ ...authState });
    return () => authState.listeners.delete(listener);
  },
  getState() {
    return { ...authState };
  },
};
})();
