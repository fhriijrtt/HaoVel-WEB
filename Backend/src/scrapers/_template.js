/**
 * TEMPLATE SCRAPER — salin file ini untuk membuat scraper source baru.
 *
 * Langkah:
 *   1. Salin file ini → scrapers/namasource.js
 *   2. Isi SOURCE_ID, BASE_URL, LIST_PAGES
 *   3. Implementasi parseListPage(), parseNovelPage(), scrapeChapter()
 *   4. Daftarkan di scrapers/registry.js
 *
 * PENTING: id novel HARUS diawali SOURCE_ID + '_'
 *   Contoh: SOURCE_ID = 'novelku' → id = 'novelku_judul-novel'
 */

'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');

const SOURCE_ID = 'namasource';            // ← ganti
const BASE_URL  = 'https://example.com';  // ← ganti

const LIST_PAGES = [
  `${BASE_URL}/daftar-novel`,              // ← ganti
];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

async function fetchHtml(url) {
  const res = await axios.get(url, { headers: HEADERS, timeout: 20000 });
  return res.data;
}

function makeId(slug) {
  return `${SOURCE_ID}_${slug}`;
}

/** Return true jika URL ini adalah halaman dari source ini */
function canHandleUrl(url) {
  return typeof url === 'string' && url.includes('example.com'); // ← ganti domain
}

/** Scrape daftar novel dari halaman list */
async function scrapeList() {
  const results = [];
  for (const listUrl of LIST_PAGES) {
    const html = await fetchHtml(listUrl);
    const $    = cheerio.load(html);

    // TODO: sesuaikan selector dengan struktur HTML source
    $('a.novel-link').each((_, el) => {
      const $el  = $(el);
      const href = $el.attr('href') || '';
      const slug = href.split('/').filter(Boolean).pop() || '';
      results.push({
        id:     makeId(slug),
        title:  $el.text().trim(),
        cover:  $el.find('img').attr('src') || '',
        author: '',
        url:    href,
      });
    });
  }
  return results;
}

/** Scrape detail satu novel */
async function scrapeDetail(novelUrl) {
  const html = await fetchHtml(novelUrl);
  const $    = cheerio.load(html);

  const slug = novelUrl.split('/').filter(Boolean).pop() || '';

  // TODO: sesuaikan selector
  const title    = $('h1.novel-title').text().trim();
  const cover    = $('img.novel-cover').attr('src') || '';
  const author   = $('span.author').text().trim();
  const synopsis = $('div.synopsis').text().trim();

  const volumes = [];
  // TODO: parse volume & chapter list

  return {
    id:          makeId(slug),
    title,
    cover,
    author,
    artist:      '',
    genres:      [],
    synopsis,
    volumes,
    updatedAt:   null,
    publishedAt: null,
    source:      SOURCE_ID,
  };
}

/** Scrape isi satu chapter */
async function scrapeChapter(chapterUrl) {
  const html = await fetchHtml(chapterUrl);
  const $    = cheerio.load(html);

  // TODO: sesuaikan selector konten chapter
  const htmlContent = $('div.chapter-content').html() || '';

  return {
    htmlContent,
    updatedAt:   null,
    publishedAt: null,
  };
}

module.exports = {
  SOURCE_ID,
  BASE_URL,
  canHandleUrl,
  scrapeList,
  scrapeDetail,
  scrapeChapter,
};
