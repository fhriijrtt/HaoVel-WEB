(() => {
/* ============================================================
   HAOVELS — app.js  v4
   Home | Explore | Bookmark | Akun + Reader
   ============================================================ */
'use strict';

const API = window.HAOVELS_CONFIG?.API_BASE_URL || 'http://localhost:3000/api';

/* ============================================================
   FILTER LAYER — 3 kategori TERPISAH
   ============================================================ */

// 1. TITLE_NOISE — untuk judul chapter di daftar (exact, pendek)
const TITLE_NOISE_RX = [
  /^\s*$/, /^prev(ious)?$/i, /^next$/i, /^menu$/i, /^list$/i,
  /^home$/i, /^back$/i, /^navigation$/i, /^page$/i,
  /^[«»<>【】\s]+$/, /^(prev|next)\s*chapter$/i,
  /^chapter\s*list$/i, /^pdf$/i, /^download\s*pdf$/i,
  /^baca\s*pdf$/i, /^daftar\s*isi$/i,
];
const isTitleNoise = (s) => {
  if (!s) return true;
  const t = s.trim();
  if (!t || t.length > 60) return !t;
  return TITLE_NOISE_RX.some(r => r.test(t));
};

// 2. NAV_INLINE — untuk elemen navigasi dalam HTML konten chapter
//    Dari analisa HTML Blogspot: nav ada sebagai <a> dengan teks navigasi
//    atau <p>/<center> yang berisi kombinasi link nav + separator |
const isNavLink = (txt) => {
  if (!txt) return false;
  const t = txt.trim();
  // a tag yang teksnya murni navigasi (pendek, exact)
  if (t.length > 50) return false;
  return /^(<<|<<=?)\s*sebelumnya/i.test(t)
      || /selanjutnya\s*(=>>|>>)$/i.test(t)
      || /^sebelumnya$/i.test(t)
      || /^selanjutnya$/i.test(t)
      || /^daftar\s*(isi|chapter|bab)$/i.test(t)
      || /^next\s*chapter$/i.test(t)
      || /^prev(ious)?\s*chapter$/i.test(t);
};

const isNavBlock = (txt) => {
  if (!txt) return false;
  const t = txt.trim();
  // Block nav: mengandung kombinasi sebelumnya+selanjutnya atau sebelumnya+daftar
  return (/sebelumnya/i.test(t) && /selanjutnya/i.test(t))
      || (/sebelumnya/i.test(t) && /daftar/i.test(t))
      || (/daftar/i.test(t) && /selanjutnya/i.test(t))
      || /^<<.*sebelumnya.*>>$/i.test(t)
      || /^\s*daftar\s*(isi|chapter|bab)\s*$/i.test(t);
};

// 3. isNoise minimal — hanya untuk volume name
const isNoise = (s) => {
  if (!s) return true;
  const t = s.trim();
  return !t || /^[«»<>\s\-_|]+$/.test(t);
};

const cleanText = (s) => (!s ? '' : String(s).replace(/\s+/g, ' ').trim());

const esc = (s) => {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

/* ============================================================
   SANITIZATION — CHAPTER LIST
   ============================================================ */
const sanitizeChapters = (chapters) => {
  if (!Array.isArray(chapters)) return [];
  const seen = new Set();
  const out  = [];
  for (const ch of chapters) {
    if (!ch || typeof ch !== 'object') continue;
    const url   = cleanText(ch.url || ch.link || ch.href || '');
    const title = cleanText(ch.title || ch.name || ch.label || '');
    if (!url) continue;
    if (title && isTitleNoise(title)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ ...ch, _url: url, _title: title || `Chapter ${out.length + 1}` });
  }
  return out;
};

/* ============================================================
   SANITIZATION — VOLUME LIST
   ============================================================ */
const normalizeVolumeName = (name, idx) => {
  const t = cleanText(name);
  if (!t || isNoise(t) || t.length > 120) return `Volume ${idx + 1}`;
  return t;
};

const sanitizeVolumes = (volumes) => {
  if (!Array.isArray(volumes)) return [];
  const seenUrl = new Set();
  const out     = [];
  volumes.forEach((vol, idx) => {
    if (!vol || typeof vol !== 'object') return;
    const name     = normalizeVolumeName(vol.name || vol.title || vol.label || '', idx);
    const chapters = sanitizeChapters(vol.chapters || vol.chapterList || []);
    if (!chapters.length) return;
    const key = chapters[0]._url;
    if (seenUrl.has(key)) return;
    seenUrl.add(key);
    out.push({ _name: name, _chapters: chapters });
  });
  return out;
};

const sanitizeFlatChapters = (data) => {
  const raw = data.chapters || data.chapterList || data.chapter_list
           || data.chapter  || data.data?.chapters || [];
  const chs = sanitizeChapters(Array.isArray(raw) ? raw : []);
  return chs.length ? [{ _name: 'Chapters', _chapters: chs }] : [];
};

const sanitizeNovelDetail = (data) => {
  if (!data || typeof data !== 'object') return null;
  let volumes = [];
  if (Array.isArray(data.volumes) && data.volumes.length)
    volumes = sanitizeVolumes(data.volumes);
  if (!volumes.length && Array.isArray(data.volume))
    volumes = sanitizeVolumes(data.volume);
  if (!volumes.length) volumes = sanitizeFlatChapters(data);
  if (!volumes.length && data.data) {
    volumes = sanitizeFlatChapters(data.data);
    if (!volumes.length && Array.isArray(data.data?.volumes))
      volumes = sanitizeVolumes(data.data.volumes);
  }
  return {
    id:       data.id || data._id || '',
    title:    cleanText(data.title || data.name || 'Untitled'),
    cover:    data.cover || data.thumbnail || data.image || '',
    author:   cleanText(data.author || data.writer || ''),
    genres:   Array.isArray(data.genres)
                ? data.genres.map(cleanText).filter(g => g && !isTitleNoise(g))
                : [],
    synopsis: cleanText(data.synopsis || data.description || data.summary || ''),
    volumes,
  };
};

/* ============================================================
   CHAPTER CONTENT EXTRACTOR
   ============================================================ */
const extractChapterContent = (data) => {
  if (!data) return '';
  const candidates = [
    data.content, data.html, data.htmlContent, data.body, data.text, data.chapter,
    data?.data?.content, data?.data?.html, data?.data?.body,
    typeof data?.data === 'string' ? data.data : null,
  ];
  for (const c of candidates)
    if (c && typeof c === 'string' && c.trim().length > 10) return c;
  if (data?.data && typeof data.data === 'object')
    for (const v of Object.values(data.data))
      if (typeof v === 'string' && v.trim().length > 10) return v;
  for (const v of Object.values(data))
    if (typeof v === 'string' && v.trim().length > 100) return v;
  return '';
};

/* ============================================================
   CHAPTER HTML SANITIZER
   Dari analisa HTML Blogspot scrape:
   - Nav ada sebagai <a href> dengan teks: "<<= Sebelumnya", "Daftar isi", "Selanjutnya =>>"
   - Dibungkus dalam <p> atau <center> atau <div>
   - Ada separator teks "|" antar link
   - Juga ada elemen header/footer blog (nav, header, footer, .main-header, dll)
   ============================================================ */
const sanitizeChapterHTML = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  const div = document.createElement('div');
  div.innerHTML = raw;

  // Hapus elemen struktural blog yang ikut ke-scrape
  div.querySelectorAll(
    'header, footer, nav, .main-header, #header-wrapper, #outer-wrapper, ' +
    '#breadcrumb, .entry-meta, .entry-header, .blog-entry-header, ' +
    '.colorify-pro-main-nav, #main-search-wrap, ' +
    'script, iframe, style, noscript, link, ' +
    '.ads, .ad-wrap, [class*="adsbygoogle"], [id*="adsbygoogle"]'
  ).forEach(n => n.remove());

  // Hapus <a> yang teksnya nav (sebelumnya/selanjutnya/daftar isi)
  div.querySelectorAll('a').forEach(a => {
    const txt = (a.textContent || '').trim();
    if (isNavLink(txt)) a.remove();
  });

  // Hapus elemen (p, div, center, span) yang SELURUH teksnya adalah nav block
  // Cek dari dalam ke luar, dari elemen terkecil dulu
  div.querySelectorAll('center, p, div').forEach(node => {
    if (!node.isConnected) return;
    const txt = (node.textContent || '').trim();
    if (!txt) { node.remove(); return; }
    if (isNavBlock(txt)) { node.remove(); return; }
  });

  // Hapus teks node kosong sisa separator "|" setelah link dihapus
  div.querySelectorAll('p, center').forEach(node => {
    if (!node.isConnected) return;
    const txt = (node.textContent || '').trim();
    if (/^[|\s|｜]+$/.test(txt)) { node.remove(); return; }
    if (!txt) node.remove();
  });

  return div.innerHTML.trim();
};

/* ============================================================
   CACHE
   ============================================================ */
const _cache = new Map();
const cacheGet = (k) => _cache.get(k) ?? null;
const cacheSet = (k, v) => { _cache.set(k, v); return v; };

/* ============================================================
   STORAGE
   ============================================================ */
const {
  getBookmarks,
  isBookmarked,
  toggleBookmark,
  getLastReadMap,
  getLastRead,
  saveLastRead,
  markRead,
  isRead,
} = window.HaovelsStorage;

/* ============================================================
   STATE
   ============================================================ */
const state = {
  tab:               'home',   // home | explore | bookmark | akun
  page:              'home',   // home | explore | bookmark | akun | detail | reader
  novels:            [],
  filtered:          [],
  currentNovel:      null,
  currentNovelId:    '',
  flatChapters:      [],
  currentChapterIdx: -1,
  searchOpen:        false,
  retryChapter:      null,
  prevPage:          'home',   // untuk back button dari detail/reader
  user:              null,
  profile:           null,
};

/* ============================================================
   DOM REFS
   ============================================================ */
const $  = (id) => document.getElementById(id);
const el = {
  header:       $('app-header'),
  btnBack:      $('btn-back'),
  headerTitle:  $('header-title'),
  btnAccount:   $('btn-account'),
  headerAvatar: $('header-avatar'),
  headerAvatarFallback: $('header-avatar-fallback'),
  btnSearch:    $('btn-search'),
  searchBar:    $('search-bar'),
  searchInput:  $('search-input'),

  pageHome:     $('page-home'),
  homeContinue: $('home-continue'),
  homeContinueEmpty: $('home-continue-empty'),
  homeRecents:  $('home-recents'),

  pageExplore:     $('page-explore'),
  novelsGrid:      $('novels-grid'),
  exploreLoading:  $('explore-loading'),
  exploreEmpty:    $('explore-empty'),
  exploreError:    $('explore-error'),

  pageBookmark:    $('page-bookmark'),
  bookmarkGrid:    $('bookmark-grid'),
  bookmarkEmpty:   $('bookmark-empty'),

  pageAkun:     $('page-akun'),
  accountSignedOut: $('account-signed-out'),
  accountSignedIn: $('account-signed-in'),
  accountConfigWarning: $('account-config-warning'),
  accountAvatar: $('account-avatar'),
  accountAvatarEmpty: $('account-avatar-empty'),
  accountName: $('account-name'),
  accountEmail: $('account-email'),
  accountBookmarkCount: $('account-bookmark-count'),
  accountHistoryCount: $('account-history-count'),

  pageDetail:      $('page-detail'),
  detailLoading:   $('detail-loading'),
  detailError:     $('detail-error'),
  detailContent:   $('detail-content'),
  detailCover:     $('detail-cover'),
  detailTitle:     $('detail-title'),
  btnReadNow:      $('btn-read-now'),
  btnBookmark:     $('btn-bookmark'),
  iconBookmark:    $('icon-bookmark'),
  labelBookmark:   $('label-bookmark'),
  detailAuthor:    $('detail-author'),
  detailGenres:    $('detail-genres'),
  detailSynopsis:  $('detail-synopsis'),
  btnSynopsis:     $('btn-synopsis-toggle'),
  volumeList:      $('volume-list'),
  volumeEmpty:     $('volume-empty'),

  pageReader:         $('page-reader'),
  readerLoading:      $('reader-loading'),
  readerError:        $('reader-error'),
  readerContent:      $('reader-content'),
  readerNovelTitle:   $('reader-novel-title'),
  readerChapterTitle: $('reader-chapter-title'),
  readerBody:         $('reader-body'),
  btnPrev:            $('btn-prev-chapter'),
  btnNext:            $('btn-next-chapter'),

  bottomNav:    $('bottom-nav'),
  toast:        $('toast'),
};

/* ============================================================
   TOAST
   ============================================================ */
let _toastTimer;
const showToast = (msg, dur = 2500) => {
  clearTimeout(_toastTimer);
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  requestAnimationFrame(() => el.toast.classList.add('show'));
  _toastTimer = setTimeout(() => {
    el.toast.classList.remove('show');
    setTimeout(() => el.toast.classList.add('hidden'), 300);
  }, dur);
};

/* ============================================================
   PAGE NAVIGATION
   ============================================================ */
const TAB_PAGES = ['home', 'explore', 'bookmark', 'akun'];
const ALL_PAGES = [...TAB_PAGES, 'detail', 'reader'];

const getPageEl = (page) => ({
  home:     el.pageHome,
  explore:  el.pageExplore,
  bookmark: el.pageBookmark,
  akun:     el.pageAkun,
  detail:   el.pageDetail,
  reader:   el.pageReader,
}[page]);

const showPage = (page, opts = {}) => {
  // Hide all pages
  ALL_PAGES.forEach(p => {
    const node = getPageEl(p);
    node.classList.toggle('active', p === page);
    node.classList.toggle('hidden', p !== page);
  });

  const isTab    = TAB_PAGES.includes(page);
  const isReader = page === 'reader';

  // Header
  el.btnBack.classList.toggle('hidden', isTab);
  el.btnSearch.classList.toggle('hidden', page !== 'explore');

  // Bottom nav — hide on reader
  el.bottomNav.classList.toggle('hidden', isReader);

  // Header title
  if (isTab) {
    const labels = { home: 'Haovels', explore: 'Explore', bookmark: 'Bookmark', akun: 'Akun' };
    el.headerTitle.textContent = labels[page] || 'Haovels';
    if (state.searchOpen) closeSearch();
  } else if (page === 'reader') {
    el.headerTitle.textContent = '';
  }

  // Update bottom nav active state
  if (isTab) {
    state.tab = page;
    document.querySelectorAll('.bnav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.action === `nav-${page}`);
    });
  }

  // Track prev page for back button
  if (opts.from) state.prevPage = opts.from;

  state.page = page;
  if (page === 'akun') renderAccountPage();
  window.scrollTo({ top: 0, behavior: 'instant' });
};

/* ============================================================
   API
   ============================================================ */
const apiFetch = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/* ============================================================
   AUTH UI
   ============================================================ */
const isSupabaseEnabled = () => !!window.HaovelsSupabase;
const getDisplayName = () => state.profile?.username
  || state.user?.user_metadata?.name
  || state.user?.email?.split('@')[0]
  || 'User';
const getAvatarUrl = () => state.profile?.avatar_url
  || state.user?.user_metadata?.avatar_url
  || state.user?.user_metadata?.picture
  || '';

const setAvatar = (imgEl, fallbackEl, name, url) => {
  const initial = (name || 'A').trim().charAt(0).toUpperCase() || 'A';
  fallbackEl.textContent = initial;
  if (url) {
    imgEl.src = url;
    imgEl.alt = name;
    imgEl.classList.remove('hidden');
    fallbackEl.classList.add('hidden');
  } else {
    imgEl.removeAttribute('src');
    imgEl.classList.add('hidden');
    fallbackEl.classList.remove('hidden');
  }
};

const updateAuthChrome = () => {
  el.btnAccount.classList.toggle('hidden', !state.user);
  if (!state.user) return;
  setAvatar(el.headerAvatar, el.headerAvatarFallback, getDisplayName(), getAvatarUrl());
};

const renderAccountPage = () => {
  const signedIn = !!state.user;
  el.accountSignedOut.classList.toggle('hidden', signedIn);
  el.accountSignedIn.classList.toggle('hidden', !signedIn);
  el.accountConfigWarning.classList.toggle('hidden', isSupabaseEnabled());

  if (!signedIn) return;

  const name = getDisplayName();
  const avatarUrl = getAvatarUrl();
  el.accountName.textContent = name;
  el.accountEmail.textContent = state.user?.email || '';
  setAvatar(el.accountAvatar, el.accountAvatarEmpty, name, avatarUrl);
  el.accountBookmarkCount.textContent = String(Object.keys(getBookmarks()).length);
  el.accountHistoryCount.textContent = String(Object.keys(getLastReadMap()).length);
};

const handleAuthChange = async ({ user, profile }) => {
  state.user = user;
  state.profile = profile;
  await window.HaovelsStorage.syncFromRemote();
  updateAuthChrome();
  renderHome();
  if (state.page === 'bookmark') renderBookmarkPage();
  if (state.page === 'akun') renderAccountPage();
  if (state.currentNovelId) syncBookmarkBtn(state.currentNovelId);
};

/* ============================================================
   HOME PAGE
   ============================================================ */
const renderHome = () => {
  renderHomeContinue();
  renderHomeRecents();
};

const renderHomeContinue = () => {
  const lrMap   = getLastReadMap();
  const entries = Object.entries(lrMap)
    .sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0))
    .slice(0, 10);

  if (!entries.length) {
    el.homeContinueEmpty.classList.remove('hidden');
    el.homeContinue.innerHTML = '';
    return;
  }
  el.homeContinueEmpty.classList.add('hidden');

  // Ambil info novel dari cache atau novels list
  const novels = state.novels;
  el.homeContinue.innerHTML = entries.map(([nid, lr]) => {
    const novel = novels.find(n => (n.id || n._id) === nid) || {};
    const title = cleanText(novel.title || novel.name || lr.novelTitle || 'Novel');
    const cover = novel.cover || novel.thumbnail || novel.image || '';
    const chTitle = lr.title || 'Chapter';
    return `
      <div class="continue-card" data-action="continue-read"
           data-novel-id="${esc(nid)}"
           data-chapter-url="${esc(lr.url)}"
           data-chapter-title="${esc(chTitle)}"
           data-chapter-idx="${lr.idx ?? 0}">
        <div class="continue-card-thumb">
          ${cover
            ? `<img src="${esc(cover)}" alt="${esc(title)}" loading="lazy"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : ''}
          <div class="continue-card-placeholder"${cover ? ' style="display:none"' : ''}>📖</div>
        </div>
        <div class="continue-card-info">
          <p class="continue-card-title">${esc(title)}</p>
          <p class="continue-card-chapter">${esc(chTitle)}</p>
          <span class="continue-badge">Lanjutkan</span>
        </div>
      </div>`;
  }).join('');
};

const renderHomeRecents = () => {
  const novels = [...state.novels].slice(0, 12);
  if (!novels.length) { el.homeRecents.innerHTML = ''; return; }
  el.homeRecents.innerHTML = novels.map(n => {
    const title = cleanText(n.title || n.name || 'Untitled');
    const id    = n.id || n._id || '';
    const cover = n.cover || n.thumbnail || n.image || '';
    return `
      <div class="novel-card-h" data-action="open-novel" data-id="${esc(id)}">
        ${cover
          ? `<img class="novel-card-h-thumb" src="${esc(cover)}" alt="${esc(title)}" loading="lazy"
                  onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : ''}
        <div class="novel-card-h-placeholder"${cover ? ' style="display:none"' : ''}>📖</div>
        <p class="novel-card-h-title">${esc(title)}</p>
      </div>`;
  }).join('');
};

/* ============================================================
   EXPLORE
   ============================================================ */
const loadExplore = async () => {
  const cached = cacheGet('novels');
  if (cached) { state.novels = cached; state.filtered = cached; renderGrid(cached); return; }
  setExploreState('loading');
  try {
    const data   = await apiFetch(`${API}/novels`);
    const novels = Array.isArray(data)         ? data
                 : Array.isArray(data?.data)   ? data.data
                 : Array.isArray(data?.novels) ? data.novels : [];
    state.novels = state.filtered = novels;
    cacheSet('novels', novels);
    renderGrid(novels);
  } catch (e) {
    console.error('loadExplore:', e);
    setExploreState('error');
  }
};

const setExploreState = (s) => {
  el.exploreLoading.classList.toggle('hidden', s !== 'loading');
  el.exploreEmpty.classList.toggle('hidden',   s !== 'empty');
  el.exploreError.classList.toggle('hidden',   s !== 'error');
};

const renderGrid = (novels) => {
  if (!novels?.length) { setExploreState('empty'); return; }
  setExploreState('none');
  el.novelsGrid.innerHTML = novels.map(novelCard).join('');
};

const novelCard = (n) => {
  const title = cleanText(n.title || n.name || 'Untitled');
  const id    = n.id || n._id || '';
  const cover = n.cover || n.thumbnail || n.image || '';
  return `
    <div class="novel-card" role="listitem" data-action="open-novel" data-id="${esc(id)}">
      ${cover ? `<img class="novel-card-thumb" src="${esc(cover)}" alt="${esc(title)}" loading="lazy"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
      <div class="novel-card-thumb-placeholder"${cover ? ' style="display:none"' : ''}>📖</div>
      <div class="novel-card-info"><p class="novel-card-title">${esc(title)}</p></div>
    </div>`;
};

/* ============================================================
   BOOKMARK PAGE
   ============================================================ */
const renderBookmarkPage = () => {
  const bm      = getBookmarks();
  const entries = Object.entries(bm).sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
  if (!entries.length) {
    el.bookmarkEmpty.classList.remove('hidden');
    el.bookmarkGrid.innerHTML = '';
    el.bookmarkEmpty.querySelector('p').textContent = 'Belum ada novel yang di-bookmark';
    const note = el.bookmarkEmpty.querySelector('small');
    if (note) note.textContent = 'Buka novel dan tap Bookmark';
    return;
  }
  el.bookmarkEmpty.classList.add('hidden');
  el.bookmarkGrid.innerHTML = entries.map(([id, meta]) => {
    const title = cleanText(meta.title || 'Novel');
    const cover = meta.cover || '';
    return `
      <div class="novel-card" role="listitem" data-action="open-novel" data-id="${esc(id)}">
        ${cover ? `<img class="novel-card-thumb" src="${esc(cover)}" alt="${esc(title)}" loading="lazy"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
        <div class="novel-card-thumb-placeholder"${cover ? ' style="display:none"' : ''}>📖</div>
        <div class="novel-card-info"><p class="novel-card-title">${esc(title)}</p></div>
      </div>`;
  }).join('');
};

/* ============================================================
   DETAIL
   ============================================================ */
const loadDetail = async (id) => {
  state.prevPage = state.tab;
  showPage('detail');
  state.currentNovelId = id;
  const cached = cacheGet(`detail_${id}`);
  if (cached) { renderDetail(cached); return; }
  setDetailState('loading');
  try {
    const raw  = await apiFetch(`${API}/novels/${id}`);
    const data = sanitizeNovelDetail(raw?.data || raw);
    if (!data) throw new Error('empty');
    cacheSet(`detail_${id}`, data);
    renderDetail(data);
  } catch (e) {
    console.error('loadDetail:', e);
    setDetailState('error');
  }
};

const setDetailState = (s) => {
  el.detailLoading.classList.toggle('hidden',  s !== 'loading');
  el.detailError.classList.toggle('hidden',    s !== 'error');
  el.detailContent.classList.toggle('hidden',  s !== 'ready');
};

const renderDetail = (novel) => {
  state.currentNovel = novel;
  el.headerTitle.textContent = novel.title;
  state.flatChapters = novel.volumes.flatMap(v => v._chapters);

  if (novel.cover) {
    el.detailCover.src = novel.cover;
    el.detailCover.alt = novel.title;
    el.detailCover.onerror = () => { el.detailCover.parentElement.style.display = 'none'; };
    el.detailCover.parentElement.style.display = '';
  } else {
    el.detailCover.parentElement.style.display = 'none';
  }
  el.detailTitle.textContent = novel.title;

  const lastRead = getLastRead(state.currentNovelId);
  if (lastRead?.url) {
    el.btnReadNow.dataset.chapterUrl   = lastRead.url;
    el.btnReadNow.dataset.chapterTitle = lastRead.title || '';
    el.btnReadNow.dataset.chapterIdx   = String(lastRead.idx ?? 0);
    el.btnReadNow.disabled = false;
    el.btnReadNow.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg> Lanjutkan Baca`;
  } else if (state.flatChapters.length) {
    const first = state.flatChapters[0];
    el.btnReadNow.dataset.chapterUrl   = first._url;
    el.btnReadNow.dataset.chapterTitle = first._title;
    el.btnReadNow.dataset.chapterIdx   = '0';
    el.btnReadNow.disabled = false;
    el.btnReadNow.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg> Baca Sekarang`;
  } else {
    el.btnReadNow.disabled = true;
    el.btnReadNow.textContent = 'Belum ada chapter';
  }

  syncBookmarkBtn(state.currentNovelId);
  el.detailAuthor.textContent = novel.author || '—';
  el.detailGenres.innerHTML = novel.genres.length
    ? novel.genres.map(g => `<span class="genre-chip">${esc(g)}</span>`).join('')
    : '<span class="meta-value">—</span>';
  el.detailSynopsis.textContent = novel.synopsis || 'Tidak ada sinopsis.';
  el.detailSynopsis.classList.remove('expanded');
  el.btnSynopsis.classList.toggle('hidden', (novel.synopsis || '').length < 200);
  el.btnSynopsis.textContent = 'Selengkapnya';
  renderVolumes(novel.volumes);
  setDetailState('ready');
};

const syncBookmarkBtn = (id) => {
  const bm = isBookmarked(id);
  el.btnBookmark.classList.toggle('bookmarked', bm);
  el.iconBookmark.setAttribute('fill', bm ? 'currentColor' : 'none');
  el.labelBookmark.textContent = bm ? 'Tersimpan' : 'Bookmark';
};

const renderVolumes = (volumes) => {
  if (!volumes?.length) {
    el.volumeEmpty.classList.remove('hidden');
    el.volumeList.innerHTML = '';
    return;
  }
  el.volumeEmpty.classList.add('hidden');
  el.volumeList.innerHTML = volumes.map(volumeItem).join('');
  const first = el.volumeList.querySelector('.volume-item');
  if (first) first.classList.add('open');
};

const volumeItem = (vol, vi) => {
  const chHTML = vol._chapters.map((ch) => {
    const gIdx = state.flatChapters.findIndex(f => f._url === ch._url);
    const read = isRead(ch._url);
    return `
      <div class="chapter-item${read ? ' read' : ''}" role="button" tabindex="0"
           data-action="open-chapter"
           data-url="${esc(ch._url)}"
           data-title="${esc(ch._title)}"
           data-idx="${gIdx}">
        <span class="chapter-dot"></span>
        <span class="chapter-title">${esc(ch._title)}</span>
      </div>`;
  }).join('');
  return `
    <div class="volume-item" data-vi="${vi}">
      <div class="volume-header" data-action="toggle-volume" data-vi="${vi}">
        <span class="volume-name">${esc(vol._name)}</span>
        <span class="volume-count">${vol._chapters.length} ch</span>
        <svg class="volume-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="chapter-list">${chHTML}</div>
    </div>`;
};

/* ============================================================
   READER
   ============================================================ */
const loadChapter = async (url, title, idx) => {
  const numIdx = Number(idx);
  showPage('reader');
  state.currentChapterIdx = numIdx;
  state.retryChapter      = { url, title, idx: numIdx };
  el.readerNovelTitle.textContent   = state.currentNovel?.title || '';
  el.readerChapterTitle.textContent = title || 'Chapter';
  el.headerTitle.textContent        = title || 'Chapter';
  setReaderState('loading');
  updateNavBtns();

  const ckey = `ch_${url}`;
  const hit  = cacheGet(ckey);
  if (hit !== null) { renderChapter(hit, url, title, numIdx); return; }

  try {
    const data    = await apiFetch(`${API}/chapter?url=${encodeURIComponent(url)}`);
    const rawHTML = extractChapterContent(data);
    if (!rawHTML) {
      console.warn('[chapter] kosong. Keys:', Object.keys(data || {}));
      el.readerBody.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:3rem 1rem">
        ⚠️ Konten chapter tidak tersedia dari server.</p>`;
      markRead(url);
      saveLastRead(state.currentNovelId, { url, title, idx: numIdx, novelTitle: state.currentNovel?.title });
      setReaderState('ready');
      updateNavBtns();
      return;
    }
    const cleaned = sanitizeChapterHTML(rawHTML);
    cacheSet(ckey, cleaned);
    renderChapter(cleaned, url, title, numIdx);
  } catch (e) {
    console.error('loadChapter:', e);
    setReaderState('error');
  }
};

const renderChapter = (html, url, title, idx) => {
  el.readerBody.innerHTML = html || `<p style="color:var(--text-muted);text-align:center;padding:2rem">Konten tidak tersedia.</p>`;
  el.readerChapterTitle.textContent = title || 'Chapter';
  el.readerNovelTitle.textContent   = state.currentNovel?.title || '';
  markRead(url);
  saveLastRead(state.currentNovelId, {
    url, title, idx,
    novelTitle: state.currentNovel?.title,
    savedAt: Date.now(),
  });
  document.querySelectorAll(`.chapter-item[data-url="${CSS.escape(url)}"]`)
    .forEach(n => n.classList.add('read'));
  setReaderState('ready');
  updateNavBtns();
  window.scrollTo({ top: 0, behavior: 'instant' });
};

const setReaderState = (s) => {
  el.readerLoading.classList.toggle('hidden', s !== 'loading');
  el.readerError.classList.toggle('hidden',   s !== 'error');
  el.readerContent.classList.toggle('hidden', s !== 'ready');
};

const updateNavBtns = () => {
  const idx = state.currentChapterIdx;
  const len = state.flatChapters.length;
  el.btnPrev.disabled = idx <= 0;
  el.btnNext.disabled = idx < 0 || idx >= len - 1;
};

/* ============================================================
   SEARCH
   ============================================================ */
const openSearch = () => {
  state.searchOpen = true;
  el.searchBar.classList.remove('hidden');
  el.searchInput.focus();
};
const closeSearch = () => {
  state.searchOpen = false;
  el.searchBar.classList.add('hidden');
  el.searchInput.value = '';
  renderGrid(state.novels);
};
const filterNovels = (q) => {
  const query = q.toLowerCase().trim();
  if (!query) { renderGrid(state.novels); return; }
  state.filtered = state.novels.filter(n => {
    const t = (n.title || n.name || '').toLowerCase();
    const a = (n.author || n.writer || '').toLowerCase();
    return t.includes(query) || a.includes(query);
  });
  renderGrid(state.filtered);
};

/* ============================================================
   EVENT DELEGATION
   ============================================================ */
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const { action } = target.dataset;

  switch (action) {

    // ── Bottom nav tabs ──
    case 'nav-home':
      showPage('home');
      renderHome();
      break;
    case 'nav-explore':
      showPage('explore');
      if (!state.novels.length) loadExplore();
      break;
    case 'nav-bookmark':
      showPage('bookmark');
      renderBookmarkPage();
      break;
    case 'nav-akun':
      showPage('akun');
      renderAccountPage();
      break;

    // ── Open novel ──
    case 'open-novel': {
      const id = target.dataset.id;
      if (id) loadDetail(id);
      break;
    }

    // ── Continue read (home card) ──
    case 'continue-read': {
      const nid = target.dataset.novelId;
      const url   = target.dataset.chapterUrl;
      const title = target.dataset.chapterTitle || '';
      const idx   = Number(target.dataset.chapterIdx ?? 0);
      if (nid && !state.currentNovel) {
        // Load novel detail dulu biar flatChapters terisi
        loadDetail(nid).then ? null : null;
        // Langsung load chapter, novel detail akan di-cache
        const cached = cacheGet(`detail_${nid}`);
        if (cached) {
          state.currentNovel      = cached;
          state.currentNovelId    = nid;
          state.flatChapters      = cached.volumes.flatMap(v => v._chapters);
        }
      }
      if (url) loadChapter(url, title, idx);
      break;
    }

    // ── Read now ──
    case 'read-now': {
      const url   = target.dataset.chapterUrl;
      const title = target.dataset.chapterTitle || '';
      const idx   = Number(target.dataset.chapterIdx ?? 0);
      if (url) loadChapter(url, title, idx);
      break;
    }

    // ── Bookmark toggle ──
    case 'toggle-bookmark': {
      const id = state.currentNovelId;
      if (!id) break;
      const now = toggleBookmark(id, {
        title: state.currentNovel?.title,
        cover: state.currentNovel?.cover,
      });
      syncBookmarkBtn(id);
      renderAccountPage();
      showToast(now ? '🔖 Ditambahkan ke bookmark' : 'Bookmark dihapus');
      break;
    }

    // ── Open chapter ──
    case 'open-chapter': {
      const url   = target.dataset.url;
      const title = target.dataset.title || '';
      const idx   = Number(target.dataset.idx ?? 0);
      if (url) loadChapter(url, title, idx);
      break;
    }

    // ── Toggle volume accordion ──
    case 'toggle-volume': {
      const vi   = target.dataset.vi;
      const item = el.volumeList.querySelector(`.volume-item[data-vi="${vi}"]`);
      if (item) item.classList.toggle('open');
      break;
    }

    // ── Synopsis expand ──
    case 'toggle-synopsis': {
      const exp = el.detailSynopsis.classList.toggle('expanded');
      el.btnSynopsis.textContent = exp ? 'Tutup' : 'Selengkapnya';
      break;
    }

    // ── Reader nav ──
    case 'prev-chapter': {
      const prev = state.flatChapters[state.currentChapterIdx - 1];
      if (prev) loadChapter(prev._url, prev._title, state.currentChapterIdx - 1);
      break;
    }
    case 'next-chapter': {
      const next = state.flatChapters[state.currentChapterIdx + 1];
      if (next) loadChapter(next._url, next._title, state.currentChapterIdx + 1);
      break;
    }
    case 'chapter-list':
      showPage('detail');
      break;

    // ── Back button ──
    case 'go-back':
      if (state.page === 'reader')      showPage('detail');
      else if (state.page === 'detail') showPage(state.prevPage || 'home');
      break;

    // ── Search toggle ──
    case 'toggle-search':
      if (state.page !== 'explore') {
        showPage('explore');
        if (!state.novels.length) loadExplore();
        setTimeout(openSearch, 50);
      } else {
        if (state.searchOpen) closeSearch(); else openSearch();
      }
      break;

    // ── Retry ──
    case 'retry-explore': loadExplore(); break;
    case 'retry-detail':
      if (state.currentNovelId) loadDetail(state.currentNovelId);
      break;
    case 'retry-reader': {
      const r = state.retryChapter;
      if (r?.url) loadChapter(r.url, r.title, r.idx);
      break;
    }
    case 'login-google':
      window.HaovelsAuth.loginWithGoogle().catch((err) => showToast(err.message || 'Login gagal'));
      break;
    case 'logout':
      window.HaovelsAuth.logout().catch((err) => showToast(err.message || 'Logout gagal'));
      break;
  }
});

// Enter key support
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const t = e.target.closest('[data-action]');
  if (t) t.click();
});

el.searchInput.addEventListener('input',   (e) => filterNovels(e.target.value));
el.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });

/* ============================================================
   INIT
   ============================================================ */
window.HaovelsAuth.onChange((auth) => {
  handleAuthChange(auth).catch((err) => console.error('[auth] sync failed:', err));
});

const initApp = async () => {
  showPage('home');
  await window.HaovelsAuth.init();
  loadExplore().then(() => renderHome());
};

initApp();
})();
