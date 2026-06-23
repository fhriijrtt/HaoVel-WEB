/**
 * HAOVELS BACKEND — index.js
 *
 * Peran file ini HANYA sebagai orchestrator:
 *   - Jalankan server HTTP
 *   - Kelola cache (memory + disk)
 *   - Jalankan scheduler scraping berkala
 *   - Routing API ke scraper yang tepat (via registry)
 *
 * TIDAK ada logic scraping di sini. Untuk tambah source baru,
 * cukup buat scrapers/<nama>.js lalu daftarkan di scrapers/registry.js.
 *
 * ─── ENDPOINTS ───────────────────────────────────────────────
 *   GET /api/novels              → index ringan semua novel (gabungan semua source)
 *   GET /api/novels/:id          → detail novel (id format: '<source>_<slug>')
 *   GET /api/chapter?url=...     → isi chapter HTML (lazy)
 *   GET /api/health              → status scraper per source
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const { SCRAPERS, scraperForUrl, scraperForId, allSourceIds } = require('./scrapers/registry');

// ─────────────────────────────────────────────────────────────
// KONFIGURASI
// ─────────────────────────────────────────────────────────────
const PORT               = process.env.PORT || 3000;
const SCRAPE_INTERVAL_MS = Number(process.env.SCRAPE_INTERVAL_MS) || 15 * 60 * 1000;
const SCRAPE_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY) || 5;

// ─────────────────────────────────────────────────────────────
// UTIL
// ─────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor    = 0;
  async function runNext() {
    while (cursor < items.length) {
      const i = cursor++;
      try   { results[i] = await worker(items[i], i); }
      catch { results[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

function sortByUpdatedDesc(entries) {
  return [...entries].sort((a, b) => {
    const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bt - at;
  });
}

// ─────────────────────────────────────────────────────────────
// CACHE (memory + disk)
// ─────────────────────────────────────────────────────────────
const CACHE_DIR = path.join(__dirname, '..', 'cache');

function loadJson(filename, fallback) {
  try {
    const file = path.join(CACHE_DIR, filename);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) { console.error(`[cache] Baca ${filename} gagal:`, e.message); }
  return fallback;
}

function saveJson(filename, data) {
  try {
    ensureDir(CACHE_DIR);
    fs.writeFileSync(path.join(CACHE_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) { console.error(`[cache] Simpan ${filename} gagal:`, e.message); }
}

// index: { entries: ListEntry[], urlMap: {id: url}, lastScrapedAt }
// novels: { [id]: NovelDetail }
// chapters: { [url]: ChapterResult }
let   indexCache   = loadJson('index.json', null);
const novelCache   = loadJson('novels.json', {});
const chapterCache = loadJson('chapters.json', {});

// Status per source untuk /api/health
const sourceStatus = {};
allSourceIds().forEach((sid) => {
  sourceStatus[sid] = {
    isScraping:          false,
    lastScrapeStartedAt: null,
    lastScrapeFinishedAt:null,
    lastScrapeError:     null,
  };
});

// ─────────────────────────────────────────────────────────────
// SCHEDULER — scrape penuh berkala dari semua source
// ─────────────────────────────────────────────────────────────
let isScrapingGlobal = false;

async function runFullScrapeCycle() {
  if (isScrapingGlobal) {
    console.log('[scheduler] Masih berjalan, lewati siklus ini.');
    return;
  }
  isScrapingGlobal = true;
  console.log('[scheduler] Mulai siklus scraping...');

  const allListEntries = [];   // kumpulan ListEntry dari semua source
  const urlMap         = {};   // id → url, untuk fallback lazy

  // ── 1. Scrape list dari setiap source ──────────────────────
  for (const scraper of SCRAPERS) {
    const sid = scraper.SOURCE_ID;
    sourceStatus[sid].isScraping          = true;
    sourceStatus[sid].lastScrapeStartedAt = new Date().toISOString();
    sourceStatus[sid].lastScrapeError     = null;

    try {
      const entries = await scraper.scrapeList();
      entries.forEach((e) => {
        urlMap[e.id] = e.url;
        allListEntries.push(e);
      });
      console.log(`[${sid}] List selesai: ${entries.length} novel`);
    } catch (err) {
      sourceStatus[sid].lastScrapeError = err.message;
      console.error(`[${sid}] Gagal ambil list:`, err.message);
    }
  }

  // ── 2. Scrape detail tiap novel (paralel, dibatasi concurrency) ─
  let changed = 0, skipped = 0;
  await runWithConcurrency(allListEntries, SCRAPE_CONCURRENCY, async (entry) => {
    const sid     = entry.id.split('_')[0];
    const scraper = SCRAPERS.find((s) => s.SOURCE_ID === sid);
    if (!scraper) return;

    const cached = novelCache[entry.id];
    let detail;
    try {
      detail = await scraper.scrapeDetail(entry.url);
    } catch (err) {
      console.error(`[${sid}] Gagal scrape "${entry.title || entry.id}":`, err.message);
      if (cached) skipped++;
      return;
    }

    const isNew     = !cached;
    const isChanged = cached && cached.updatedAt !== detail.updatedAt;
    if (isNew || isChanged) {
      novelCache[entry.id] = detail;
      changed++;
      console.log(`[${sid}] ${isNew ? 'Baru' : 'Update'}: ${detail.title}`);
    } else {
      skipped++;
    }
  });

  saveJson('novels.json', novelCache);

  // ── 3. Rebuild index dari novelCache ──────────────────────
  const indexEntries = allListEntries.map((le) => {
    const d = novelCache[le.id];
    return {
      id:        le.id,
      title:     (d && d.title)  || le.title,
      cover:     (d && d.cover)  || le.cover,
      author:    (d && d.author) || le.author,
      updatedAt: (d && d.updatedAt) || null,
      source:    le.id.split('_')[0],
    };
  });

  indexCache = {
    entries:      sortByUpdatedDesc(indexEntries),
    urlMap,
    lastScrapedAt: new Date().toISOString(),
  };
  saveJson('index.json', indexCache);

  // Update status per source
  allSourceIds().forEach((sid) => {
    sourceStatus[sid].isScraping           = false;
    sourceStatus[sid].lastScrapeFinishedAt = indexCache.lastScrapedAt;
  });

  isScrapingGlobal = false;
  console.log(`[scheduler] Selesai. ${changed} update, ${skipped} skip, total ${allListEntries.length} novel.`);
}

// ─────────────────────────────────────────────────────────────
// FALLBACK LAZY — untuk novel yang belum ada di cache
// ─────────────────────────────────────────────────────────────
const pendingDetails  = new Map();
const pendingChapters = new Map();

async function getNovelDetail(id) {
  if (novelCache[id]) return novelCache[id];
  if (pendingDetails.has(id)) return pendingDetails.get(id);

  const promise = (async () => {
    const url     = indexCache?.urlMap?.[id];
    const scraper = scraperForId(id);
    if (!url || !scraper) return null;
    const detail = await scraper.scrapeDetail(url);
    novelCache[id] = detail;
    saveJson('novels.json', novelCache);
    return detail;
  })().finally(() => pendingDetails.delete(id));

  pendingDetails.set(id, promise);
  return promise;
}

async function getChapterContent(chapterUrl) {
  if (Object.prototype.hasOwnProperty.call(chapterCache, chapterUrl)) {
    return chapterCache[chapterUrl];
  }
  if (pendingChapters.has(chapterUrl)) return pendingChapters.get(chapterUrl);

  const promise = (async () => {
    const scraper = scraperForUrl(chapterUrl);
    if (!scraper) throw new Error(`Tidak ada scraper untuk URL: ${chapterUrl}`);
    const result = await scraper.scrapeChapter(chapterUrl);
    chapterCache[chapterUrl] = result;
    saveJson('chapters.json', chapterCache);
    return result;
  })().finally(() => pendingChapters.delete(chapterUrl));

  pendingChapters.set(chapterUrl, promise);
  return promise;
}

// ─────────────────────────────────────────────────────────────
// HTTP SERVER
// ─────────────────────────────────────────────────────────────
function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    return res.end();
  }

  const reqUrl   = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;

  try {

    // ── GET /api/novels ─────────────────────────────────────
    if (pathname === '/api/novels' && req.method === 'GET') {
      if (!indexCache) {
        return sendJson(res, 503, { error: 'Scraper sedang melakukan scrape awal, coba lagi sebentar.' });
      }
      return sendJson(res, 200, indexCache.entries);
    }

    // ── GET /api/novels/:id ─────────────────────────────────
    const detailMatch = pathname.match(/^\/api\/novels\/([^/]+)$/);
    if (detailMatch && req.method === 'GET') {
      const id     = decodeURIComponent(detailMatch[1]);
      const detail = await getNovelDetail(id);
      if (!detail) return sendJson(res, 404, { error: 'Novel tidak ditemukan' });
      return sendJson(res, 200, detail);
    }

    // ── GET /api/chapter?url=... ────────────────────────────
    if (pathname === '/api/chapter' && req.method === 'GET') {
      const chapterUrl = reqUrl.searchParams.get('url');
      if (!chapterUrl) return sendJson(res, 400, { error: 'Parameter "url" wajib diisi' });
      const result = await getChapterContent(chapterUrl);
      return sendJson(res, 200, result);
    }

    // ── GET /api/health ─────────────────────────────────────
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok:           true,
        sources:      allSourceIds(),
        novelCount:   indexCache ? indexCache.entries.length : 0,
        lastScrapedAt: indexCache ? indexCache.lastScrapedAt : null,
        isScraping:   isScrapingGlobal,
        sourceStatus,
        scrapeIntervalMs: SCRAPE_INTERVAL_MS,
      });
    }

    return sendJson(res, 404, { error: 'Endpoint tidak ditemukan' });

  } catch (err) {
    console.error('[error]', err.message);
    return sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Haovels Backend berjalan di http://localhost:${PORT}`);
  console.log(`Sources aktif: ${allSourceIds().join(', ')}`);
  console.log(`\nEndpoint:`);
  console.log(`  GET /api/novels           → semua novel (gabungan semua source)`);
  console.log(`  GET /api/novels/:id       → detail novel (id: '<source>_<slug>')`);
  console.log(`  GET /api/chapter?url=...  → isi chapter HTML`);
  console.log(`  GET /api/health           → status scraper`);
  console.log(`\nCache: ${CACHE_DIR}`);
  console.log(`Interval: ${Math.round(SCRAPE_INTERVAL_MS / 60000)} menit | Concurrency: ${SCRAPE_CONCURRENCY}\n`);

  runFullScrapeCycle();
  setInterval(runFullScrapeCycle, SCRAPE_INTERVAL_MS);
});
