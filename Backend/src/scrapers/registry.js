/**
 * SCRAPER REGISTRY
 *
 * Daftarkan scraper baru di sini — cukup import lalu push ke SCRAPERS.
 * Semua routing (by id prefix atau by URL domain) ditangani otomatis.
 *
 * Untuk tambah source baru:
 *   1. Buat file scrapers/namasource.js (ikuti contract di base.js)
 *   2. require di bawah, push ke SCRAPERS
 *   3. Selesai — index.js tidak perlu diubah sama sekali
 */

'use strict';

const kaito = require('./kaito');
// const novelku = require('./novelku');  ← contoh untuk source berikutnya

const SCRAPERS = [
  kaito,
  // novelku,
];

/**
 * Temukan scraper yang bisa handle URL ini (berdasarkan canHandleUrl).
 * @param {string} url
 * @returns scraper | null
 */
function scraperForUrl(url) {
  return SCRAPERS.find((s) => s.canHandleUrl(url)) || null;
}

/**
 * Temukan scraper berdasarkan SOURCE_ID prefix dari novel id.
 * Novel id format: '<SOURCE_ID>_<slug>', cth: 'kaito_roshidere'
 * @param {string} novelId
 * @returns scraper | null
 */
function scraperForId(novelId) {
  if (!novelId) return null;
  return SCRAPERS.find((s) => novelId.startsWith(s.SOURCE_ID + '_')) || null;
}

/**
 * Semua SOURCE_ID yang terdaftar.
 */
function allSourceIds() {
  return SCRAPERS.map((s) => s.SOURCE_ID);
}

module.exports = { SCRAPERS, scraperForUrl, scraperForId, allSourceIds };
