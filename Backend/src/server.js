'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const { SCRAPERS, scraperForId, scraperForUrl, allSourceIds } = require('./scrapers/registry');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CHAPTER_CACHE_DIR = path.join(CACHE_DIR, 'chapters');
const SCRAPE_INTERVAL_MS = Number(process.env.SCRAPE_INTERVAL_MS) || 15 * 60 * 1000;
const SCRAPE_CONCURRENCY = Math.max(1, Number(process.env.SCRAPE_CONCURRENCY) || 2);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 60 * 1000;

const state = {
  index: null,
  novels: {},
  urlMap: {},
  isScrapingIndex: false,
  startedAt: new Date().toISOString(),
  lastIndexScrapeAt: null,
  lastIndexError: null,
  sources: Object.fromEntries(allSourceIds().map((id) => [id, {
    ok: true,
    lastScrapeStartedAt: null,
    lastScrapeFinishedAt: null,
    lastError: null,
  }])),
};

const pending = {
  index: null,
  details: new Map(),
  chapters: new Map(),
};

function jsonHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, jsonHeaders());
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message, details = undefined) {
  sendJson(res, statusCode, {
    ok: false,
    error: message,
    ...(details ? { details } : {}),
  });
}

async function ensureCacheDirs() {
  await fs.mkdir(CHAPTER_CACHE_DIR, { recursive: true });
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[cache] gagal baca ${path.basename(filePath)}:`, error.message);
    }
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await ensureCacheDirs();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const raw = JSON.stringify(value);
  await fs.writeFile(tempPath, raw, 'utf8');
  await fs.rename(tempPath, filePath);
}

function chapterCachePath(chapterUrl) {
  const key = crypto.createHash('sha1').update(chapterUrl).digest('hex');
  return path.join(CHAPTER_CACHE_DIR, `${key}.json`);
}

function normalizeListEntry(entry) {
  if (!entry || !entry.id || !entry.url) return null;
  return {
    id: String(entry.id),
    title: String(entry.title || 'Untitled').trim() || 'Untitled',
    cover: entry.cover || '',
    author: entry.author || '',
    url: entry.url,
    source: entry.source || String(entry.id).split('_')[0],
    updatedAt: entry.updatedAt || null,
  };
}

function normalizeDetail(detail, fallback = {}) {
  if (!detail || typeof detail !== 'object') return null;
  return {
    id: detail.id || fallback.id || '',
    title: detail.title || fallback.title || 'Untitled',
    cover: detail.cover || fallback.cover || '',
    author: detail.author || fallback.author || '',
    artist: detail.artist || '',
    genres: Array.isArray(detail.genres) ? detail.genres : [],
    synopsis: detail.synopsis || '',
    volumes: Array.isArray(detail.volumes) ? detail.volumes : [],
    updatedAt: detail.updatedAt || null,
    publishedAt: detail.publishedAt || null,
    source: detail.source || fallback.source || String(detail.id || fallback.id || '').split('_')[0],
  };
}

async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, runner);
  await Promise.all(workers);
  return results;
}

function sortNewestFirst(entries) {
  return [...entries].sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bTime - aTime;
  });
}

async function loadCache() {
  await ensureCacheDirs();
  state.index = await readJsonFile(path.join(CACHE_DIR, 'index.json'), null);
  state.novels = await readJsonFile(path.join(CACHE_DIR, 'novels.json'), {});
  state.urlMap = state.index?.urlMap || {};
  state.lastIndexScrapeAt = state.index?.lastScrapedAt || null;
}

async function saveIndex(entries, urlMap) {
  const index = {
    ok: true,
    entries: sortNewestFirst(entries),
    urlMap,
    lastScrapedAt: new Date().toISOString(),
  };

  state.index = index;
  state.urlMap = urlMap;
  state.lastIndexScrapeAt = index.lastScrapedAt;
  await writeJsonFile(path.join(CACHE_DIR, 'index.json'), index);
}

async function saveNovels() {
  await writeJsonFile(path.join(CACHE_DIR, 'novels.json'), state.novels);
}

async function scrapeIndex({ force = false } = {}) {
  if (pending.index) return pending.index;
  if (!force && state.index?.entries?.length) return state.index;

  pending.index = (async () => {
    state.isScrapingIndex = true;
    state.lastIndexError = null;

    const collected = [];
    const urlMap = {};

    await runLimited(SCRAPERS, SCRAPE_CONCURRENCY, async (scraper) => {
      const sourceId = scraper.SOURCE_ID;
      const sourceState = state.sources[sourceId];
      sourceState.lastScrapeStartedAt = new Date().toISOString();
      sourceState.lastError = null;

      try {
        const entries = await scraper.scrapeList();
        for (const rawEntry of entries || []) {
          const entry = normalizeListEntry(rawEntry);
          if (!entry) continue;

          const cachedDetail = state.novels[entry.id];
          const mergedEntry = {
            ...entry,
            title: cachedDetail?.title || entry.title,
            cover: cachedDetail?.cover || entry.cover,
            author: cachedDetail?.author || entry.author,
            updatedAt: cachedDetail?.updatedAt || entry.updatedAt || null,
          };

          collected.push(mergedEntry);
          urlMap[entry.id] = entry.url;
        }

        sourceState.ok = true;
        sourceState.lastScrapeFinishedAt = new Date().toISOString();
      } catch (error) {
        sourceState.ok = false;
        sourceState.lastError = error.message;
        sourceState.lastScrapeFinishedAt = new Date().toISOString();
        console.error(`[${sourceId}] scrape list gagal:`, error.message);
      }
    });

    if (!collected.length && state.index?.entries?.length) {
      state.lastIndexError = 'Scrape index gagal, memakai cache lama.';
      return state.index;
    }

    if (!collected.length) {
      throw new Error('Tidak ada novel yang berhasil diambil dari scraper.');
    }

    await saveIndex(collected, urlMap);
    return state.index;
  })()
    .catch((error) => {
      state.lastIndexError = error.message;
      throw error;
    })
    .finally(() => {
      state.isScrapingIndex = false;
      pending.index = null;
    });

  return pending.index;
}

async function getNovels() {
  if (state.index?.entries?.length) return state.index.entries;
  const index = await scrapeIndex();
  return index.entries || [];
}

async function getNovelDetail(id) {
  if (state.novels[id]) return state.novels[id];
  if (pending.details.has(id)) return pending.details.get(id);

  const promise = (async () => {
    const scraper = scraperForId(id);
    if (!scraper) return null;

    if (!state.urlMap[id]) {
      await scrapeIndex({ force: !state.index?.urlMap?.[id] });
    }

    const novelUrl = state.urlMap[id];
    const fallback = state.index?.entries?.find((entry) => entry.id === id) || { id };
    if (!novelUrl) return null;

    const detail = normalizeDetail(await scraper.scrapeDetail(novelUrl), fallback);
    if (!detail) return null;

    state.novels[id] = detail;
    await saveNovels();
    return detail;
  })().finally(() => pending.details.delete(id));

  pending.details.set(id, promise);
  return promise;
}

async function getChapter(chapterUrl) {
  if (pending.chapters.has(chapterUrl)) return pending.chapters.get(chapterUrl);

  const promise = (async () => {
    const filePath = chapterCachePath(chapterUrl);
    const cached = await readJsonFile(filePath, null);
    if (cached) return cached;

    const scraper = scraperForUrl(chapterUrl);
    if (!scraper) {
      throw Object.assign(new Error('Tidak ada scraper yang cocok untuk URL chapter.'), { statusCode: 400 });
    }

    const result = await scraper.scrapeChapter(chapterUrl);
    const payload = {
      ok: true,
      url: chapterUrl,
      htmlContent: result?.htmlContent || result?.html || result?.content || '',
      updatedAt: result?.updatedAt || null,
      publishedAt: result?.publishedAt || null,
      cachedAt: new Date().toISOString(),
    };

    await writeJsonFile(filePath, payload);
    return payload;
  })().finally(() => pending.chapters.delete(chapterUrl));

  pending.chapters.set(chapterUrl, promise);
  return promise;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('Request timeout'), { statusCode: 504 })), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function route(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, jsonHeaders({ 'Content-Length': '0' }));
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, 'Method tidak diizinkan.');
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname.replace(/\/+$/, '') || '/';

  if (pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'haovels-backend',
      uptimeSec: Math.round(process.uptime()),
      startedAt: state.startedAt,
      port: PORT,
      sources: state.sources,
      cache: {
        novelCount: state.index?.entries?.length || 0,
        detailCount: Object.keys(state.novels).length,
        lastIndexScrapeAt: state.lastIndexScrapeAt,
        lastIndexError: state.lastIndexError,
        isScrapingIndex: state.isScrapingIndex,
      },
      config: {
        scrapeIntervalMs: SCRAPE_INTERVAL_MS,
        scrapeConcurrency: SCRAPE_CONCURRENCY,
      },
    });
    return;
  }

  if (pathname === '/api/novels') {
    const novels = await getNovels();
    sendJson(res, 200, novels);
    return;
  }

  const detailMatch = pathname.match(/^\/api\/novels\/([^/]+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    const detail = await getNovelDetail(id);
    if (!detail) {
      sendError(res, 404, 'Novel tidak ditemukan.');
      return;
    }
    sendJson(res, 200, detail);
    return;
  }

  if (pathname === '/api/chapter') {
    const chapterUrl = requestUrl.searchParams.get('url');
    if (!chapterUrl) {
      sendError(res, 400, 'Parameter "url" wajib diisi.');
      return;
    }

    const chapter = await getChapter(chapterUrl);
    sendJson(res, 200, chapter);
    return;
  }

  sendError(res, 404, 'Endpoint tidak ditemukan.');
}

const server = http.createServer((req, res) => {
  withTimeout(route(req, res), REQUEST_TIMEOUT_MS).catch((error) => {
    console.error('[server]', error.stack || error.message);
    if (!res.headersSent) {
      sendError(res, error.statusCode || 500, error.statusCode ? error.message : 'Internal server error.');
    } else {
      res.end();
    }
  });
});

server.on('clientError', (_error, socket) => {
  socket.end([
    'HTTP/1.1 400 Bad Request',
    'Content-Type: application/json; charset=utf-8',
    'Access-Control-Allow-Origin: *',
    'Access-Control-Allow-Methods: GET, OPTIONS',
    'Connection: close',
    '',
    '{"ok":false,"error":"Bad request"}',
  ].join('\r\n'));
});

async function bootstrap() {
  await loadCache();

  server.listen(PORT, HOST, () => {
    console.log(`[haovels] API berjalan di http://${HOST}:${PORT}`);
    console.log(`[haovels] sources: ${allSourceIds().join(', ')}`);
    console.log(`[haovels] cache: ${CACHE_DIR}`);
    console.log(`[haovels] scrape concurrency: ${SCRAPE_CONCURRENCY}`);
  });

  scrapeIndex().catch((error) => console.error('[bootstrap] scrape awal gagal:', error.message));
  setInterval(() => {
    scrapeIndex({ force: true }).catch((error) => console.error('[scheduler] scrape index gagal:', error.message));
  }, SCRAPE_INTERVAL_MS).unref();
}

process.on('SIGTERM', () => {
  console.log('[haovels] SIGTERM diterima, shutdown...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[haovels] SIGINT diterima, shutdown...');
  server.close(() => process.exit(0));
});

bootstrap().catch((error) => {
  console.error('[fatal]', error.stack || error.message);
  process.exit(1);
});
