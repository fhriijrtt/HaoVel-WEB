/**
 * KAITO SCRAPER — zerokaito.blogspot.com
 * SOURCE_ID: 'kaito'
 *
 * Semua logic scraping Kaito dipindahkan ke sini dari index.js.
 * index.js sekarang hanya berperan sebagai orchestrator.
 */

'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const { extractChapterHtml } = require('../utils/htmlCleaner');
const { extractDates }       = require('../utils/dateExtractor');

// ─────────────────────────────────────────────────────────────
// KONFIGURASI
// ─────────────────────────────────────────────────────────────
const SOURCE_ID = 'kaito';
const BASE_URL  = 'https://zerokaito.blogspot.com';

const LIST_PAGES = [
  `${BASE_URL}/p/on-going.html`,
  `${BASE_URL}/p/novel-tamat.html`,
];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const CONTENT_SELECTOR = '.post-body.entry-content';

// ─────────────────────────────────────────────────────────────
// UTIL (lokal, tidak di-export)
// ─────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    headers: HEADERS,
    timeout: Number(process.env.SCRAPER_TIMEOUT_MS) || 20000,
    maxContentLength: 5 * 1024 * 1024,
    responseType: 'text',
  });
  return res.data;
}

function absoluteUrl(href) {
  if (!href) return '';
  try {
    return new URL(href, BASE_URL).toString().split('?')[0].split('#')[0];
  } catch {
    return '';
  }
}

function directText($, el) {
  return $(el)
    .contents()
    .filter(function () { return this.type === 'text'; })
    .text()
    .trim();
}

/** Slug dari URL Blogspot → dipakai sebagai bagian id setelah prefix SOURCE_ID. */
function slugFromUrl(url) {
  const clean = url.split('?')[0].split('#')[0];
  const parts = clean.split('/').filter(Boolean);
  const last  = parts[parts.length - 1] || '';
  return last.replace(/\.html$/i, '');
}

/** Buat id novel: 'kaito_<slug>' */
function makeId(url) {
  return `${SOURCE_ID}_${slugFromUrl(url)}`;
}

function isPostUrl(href) {
  const url = absoluteUrl(href);
  if (!url.includes('zerokaito.blogspot.com')) return false;
  if (!url.endsWith('.html')) return false;
  if (url.includes('/p/')) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────
// LIST PAGE PARSER
// ─────────────────────────────────────────────────────────────
function parseListPage(html) {
  const $ = cheerio.load(html);
  const content = $(CONTENT_SELECTOR).first();
  const map = new Map(); // id → entry

  function entryFor(url) {
    const id = makeId(url);
    if (!map.has(id)) {
      map.set(id, { id, title: '', cover: '', author: '', url });
    }
    return map.get(id);
  }

  content.find('*').each((_, el) => {
    const $el = $(el);
    const tag = el.tagName ? el.tagName.toLowerCase() : '';

    if (tag === 'a') {
      const url = absoluteUrl($el.attr('href'));
      if (!isPostUrl(url)) return;
      const title = $el.text().trim();
      const entry = entryFor(url);
      if (title && !entry.title) entry.title = title;
      return;
    }

    if (tag === 'img') {
      const parentLink = $el.closest('a[href]');
      const url = absoluteUrl(parentLink.attr('href'));
      if (!isPostUrl(url)) return;
      const src = absoluteUrl($el.attr('src') || $el.attr('data-src') || '');
      if (!src) return;
      const entry = entryFor(url);
      if (!entry.cover) entry.cover = src;
      return;
    }

    if (['p', 'div', 'span', 'li'].includes(tag)) {
      const txt   = directText($, el);
      const match = txt.match(/^(author|penulis)\s*:\s*(.+)$/i);
      if (!match) return;
      const lastEntry = Array.from(map.values()).pop();
      if (lastEntry && !lastEntry.author) lastEntry.author = match[2].trim();
    }
  });

  return Array.from(map.values());
}

// ─────────────────────────────────────────────────────────────
// NOVEL DETAIL PARSER
// ─────────────────────────────────────────────────────────────
function parseNovelPage(html, novelUrl) {
  const { updatedAt, publishedAt } = extractDates(html);
  const $ = cheerio.load(html);
  const content = $(CONTENT_SELECTOR).first();

  const title =
    $('h1.entry-title').first().text().trim() ||
    $('h3.post-title.entry-title').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') || '';

  let author = '', artist = '', genres = [], synopsisParts = [], mainCover = '';
  let volumes = [], currentVolume = null;
  let beforeFirstVolume = true, synopsisStarted = false;

  const LABEL = {
    author:   /^(author\(s\)|author|penulis)\s*:\s*/i,
    artist:   /^(artist\(s\)|artist|illustrator)\s*:\s*/i,
    genre:    /^(genre|genres)\s*:\s*/i,
    synopsis: /^(synopsis|sinopsis)\s*:\s*/i,
  };

  content.find('*').each((_, el) => {
    const $el = $(el);
    const tag = el.tagName ? el.tagName.toLowerCase() : '';

    // Marker Volume
    if (['p', 'div', 'span', 'b', 'strong', 'h3', 'h4', 'li'].includes(tag)) {
      const txt = directText($, el) || $el.text().trim();
      if (/^volume\s*\d+/i.test(txt)) {
        const match  = txt.match(/volume\s*0*(\d+)/i);
        const number = match ? parseInt(match[1], 10) : volumes.length + 1;
        currentVolume = { number, name: txt.trim() || `Volume ${number}`, cover: '', chapters: [] };
        volumes.push(currentVolume);
        beforeFirstVolume = false;
        return;
      }
    }

    // Metadata label
    if (beforeFirstVolume && ['p', 'div', 'span'].includes(tag)) {
      const txt = $el.text().trim();
      if (LABEL.author.test(txt))   { author = txt.replace(LABEL.author, '').trim(); return; }
      if (LABEL.artist.test(txt))   { artist = txt.replace(LABEL.artist, '').trim(); return; }
      if (LABEL.genre.test(txt)) {
        genres = txt.replace(LABEL.genre, '').split(/[,|·]/).map(g => g.trim()).filter(Boolean);
        return;
      }
      if (LABEL.synopsis.test(txt)) {
        synopsisStarted = true;
        const rest = txt.replace(LABEL.synopsis, '').trim();
        if (rest) synopsisParts.push(rest);
        return;
      }
      if (synopsisStarted && tag === 'p' && txt) synopsisParts.push(txt);
    }

    // Gambar
    if (tag === 'img') {
      const src = absoluteUrl($el.attr('src') || $el.attr('data-src') || '');
      if (!src) return;
      if (beforeFirstVolume) { if (!mainCover) mainCover = src; return; }
      if (currentVolume && !currentVolume.cover && currentVolume.chapters.length === 0) {
        currentVolume.cover = src;
      }
      return;
    }

    // Link chapter
    if (tag === 'a') {
      const href     = absoluteUrl($el.attr('href'));
      const linkText = $el.text().trim();
      if (!href || !linkText || !currentVolume) return;
      currentVolume.chapters.push({
        title: linkText,
        url:   href,
        order: currentVolume.chapters.length,
      });
    }
  });

  return {
    id:        makeId(novelUrl),
    title,
    cover:     mainCover,
    author,
    artist,
    genres,
    synopsis:  synopsisParts.join('\n\n').trim(),
    volumes,
    updatedAt,
    publishedAt,
    source:    SOURCE_ID,
  };
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API — memenuhi contract base.js
// ─────────────────────────────────────────────────────────────

/** Return true jika URL ini adalah halaman dari zerokaito.blogspot.com */
function canHandleUrl(url) {
  return typeof url === 'string' && url.includes('zerokaito.blogspot.com');
}

/** Ambil semua novel dari semua list page Kaito */
async function scrapeList() {
  const merged = new Map();
  for (const listUrl of LIST_PAGES) {
    console.log(`[kaito] Mengambil daftar: ${listUrl}`);
    const html    = await fetchHtml(listUrl);
    const entries = parseListPage(html);
    entries.forEach((e) => {
      if (!merged.has(e.id)) merged.set(e.id, e);
      else {
        const ex = merged.get(e.id);
        if (!ex.cover  && e.cover)  ex.cover  = e.cover;
        if (!ex.author && e.author) ex.author = e.author;
      }
    });
    await sleep(300);
  }
  return Array.from(merged.values());
}

/** Scrape detail satu novel dari URL-nya */
async function scrapeDetail(novelUrl) {
  console.log(`[kaito] Scraping detail: ${novelUrl}`);
  const html = await fetchHtml(novelUrl);
  return parseNovelPage(html, novelUrl);
}

/** Scrape isi satu chapter */
async function scrapeChapter(chapterUrl) {
  console.log(`[kaito] Mengambil chapter: ${chapterUrl}`);
  const html = await fetchHtml(chapterUrl);
  return extractChapterHtml(html); // { htmlContent, updatedAt, publishedAt }
}

module.exports = {
  SOURCE_ID,
  BASE_URL,
  canHandleUrl,
  scrapeList,
  scrapeDetail,
  scrapeChapter,
};
