(() => {
  'use strict';

const BM_KEY = 'haovels_bookmarks';
const RH_KEY = 'haovels_read';
const LR_KEY = 'haovels_lastread';

let bookmarksCache = null;
let readMapCache = null;
let lastReadCache = null;

const readJson = (key, fallback = {}) => {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

const getCurrentUserId = () => window.HaovelsAuth?.getState().user?.id || null;
const getSupabase = () => window.HaovelsSupabase || null;

const getBookmarks = () => bookmarksCache || readJson(BM_KEY);
const saveBookmarks = (bookmarks) => {
  bookmarksCache = bookmarks;
  writeJson(BM_KEY, bookmarks);
};
const isBookmarked = (id) => !!getBookmarks()[id];
const toggleBookmark = (id, meta = {}) => {
  const bookmarks = getBookmarks();
  const wasBookmarked = !!bookmarks[id];
  if (bookmarks[id]) {
    delete bookmarks[id];
  } else {
    bookmarks[id] = { ...meta, savedAt: Date.now() };
  }
  saveBookmarks(bookmarks);
  syncBookmarkChange(id, bookmarks[id], wasBookmarked);
  return !!bookmarks[id];
};

const getReadMap = () => readMapCache || readJson(RH_KEY);
const markRead = (url) => {
  const readMap = getReadMap();
  readMap[url] = Date.now();
  readMapCache = readMap;
  writeJson(RH_KEY, readMap);
};
const isRead = (url) => !!getReadMap()[url];

const getLastReadMap = () => lastReadCache || readJson(LR_KEY);
const getLastRead = (novelId) => getLastReadMap()[novelId] || null;
const saveLastRead = (novelId, data) => {
  const lastReadMap = getLastReadMap();
  lastReadMap[novelId] = data;
  lastReadCache = lastReadMap;
  writeJson(LR_KEY, lastReadMap);
  const bookmarks = getBookmarks();
  if (bookmarks[novelId]) {
    bookmarks[novelId] = {
      ...bookmarks[novelId],
      lastChapter: data.title || bookmarks[novelId].lastChapter || '',
    };
    saveBookmarks(bookmarks);
  }
  syncReadingHistory(novelId, data);
};

const syncBookmarkChange = async (mangaId, meta, wasBookmarked) => {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  if (!supabase || !userId) return;

  try {
    if (wasBookmarked && !meta) {
      await supabase
        .from('bookmarks')
        .delete()
        .eq('user_id', userId)
        .eq('manga_id', mangaId);
      return;
    }

    await supabase.from('bookmarks').upsert({
      user_id: userId,
      manga_id: mangaId,
      title: meta?.title || 'Novel',
      cover: meta?.cover || '',
      last_chapter: meta?.lastChapter || getLastRead(mangaId)?.title || '',
    }, { onConflict: 'user_id,manga_id' });
  } catch (error) {
    console.error('[storage] bookmark sync failed:', error.message);
  }
};

const syncReadingHistory = async (mangaId, data) => {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  if (!supabase || !userId || !mangaId || !data?.url) return;

  try {
    await supabase.from('reading_history').upsert({
      user_id: userId,
      manga_id: mangaId,
      chapter_id: data.url,
      title: data.title || 'Chapter',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,manga_id' });

    if (getBookmarks()[mangaId]) {
      await supabase
        .from('bookmarks')
        .update({ last_chapter: data.title || 'Chapter' })
        .eq('user_id', userId)
        .eq('manga_id', mangaId);
    }
  } catch (error) {
    console.error('[storage] reading history sync failed:', error.message);
  }
};

const syncFromRemote = async () => {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  if (!supabase) {
    bookmarksCache = readJson(BM_KEY);
    readMapCache = readJson(RH_KEY);
    lastReadCache = readJson(LR_KEY);
    return;
  }
  if (!userId) {
    bookmarksCache = readJson(BM_KEY);
    readMapCache = readJson(RH_KEY);
    lastReadCache = readJson(LR_KEY);
    return;
  }

  const [{ data: bookmarks, error: bookmarkError }, { data: histories, error: historyError }] = await Promise.all([
    supabase
      .from('bookmarks')
      .select('manga_id,title,cover,last_chapter,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('reading_history')
      .select('manga_id,chapter_id,title,updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false }),
  ]);

  if (bookmarkError) console.error('[storage] load bookmarks failed:', bookmarkError.message);
  if (historyError) console.error('[storage] load history failed:', historyError.message);

  bookmarksCache = {};
  (bookmarks || []).forEach((item) => {
    bookmarksCache[item.manga_id] = {
      title: item.title,
      cover: item.cover,
      lastChapter: item.last_chapter,
      savedAt: new Date(item.created_at).getTime(),
    };
  });
  writeJson(BM_KEY, bookmarksCache);

  readMapCache = {};
  lastReadCache = {};
  (histories || []).forEach((item) => {
    const timestamp = new Date(item.updated_at).getTime();
    readMapCache[item.chapter_id] = timestamp;
    lastReadCache[item.manga_id] = {
      url: item.chapter_id,
      title: item.title,
      novelTitle: item.title,
      savedAt: timestamp,
    };
  });
  writeJson(RH_KEY, readMapCache);
  writeJson(LR_KEY, lastReadCache);
};

window.HaovelsStorage = {
  getBookmarks,
  saveBookmarks,
  isBookmarked,
  toggleBookmark,
  getReadMap,
  markRead,
  isRead,
  getLastReadMap,
  getLastRead,
  saveLastRead,
  syncFromRemote,
};
})();
