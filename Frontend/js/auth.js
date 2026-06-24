(() => {
  'use strict';

const authState = {
  ready: false,
  user: null,
  profile: null,
  listeners: new Set(),
};

let authSubscription = null;

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

const getCurrentUser = async () => {
  const supabase = window.HaovelsSupabase;
  if (!supabase) {
    authState.ready = true;
    notifyAuthListeners();
    return { ...authState };
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[auth] get session failed:', error.message);
    await setSessionUser(null);
    return { ...authState };
  }

  await setSessionUser(data?.session || null);
  return { ...authState };
};

const listenAuthChanges = () => {
  const supabase = window.HaovelsSupabase;
  if (!supabase || authSubscription) return;

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    setSessionUser(session).catch((err) => {
      console.error('[auth] state change failed:', err);
    });
  });

  authSubscription = data?.subscription || null;
};

const initAuth = async () => {
  listenAuthChanges();
  return getCurrentUser();
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

const logoutUser = async () => {
  const supabase = window.HaovelsSupabase;
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

window.HaovelsAuth = {
  init: initAuth,
  initAuthListener: listenAuthChanges,
  getCurrentUser,
  loginWithGoogle,
  logoutUser,
  logout: logoutUser,
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
