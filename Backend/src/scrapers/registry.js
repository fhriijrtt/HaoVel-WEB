'use strict';

const kaito = require('./kaito');

const SCRAPERS = [
  kaito,
].filter(Boolean);

function scraperForUrl(url) {
  if (!url) return null;

  return SCRAPERS.find((scraper) => {
    try {
      return typeof scraper.canHandleUrl === 'function' && scraper.canHandleUrl(url);
    } catch {
      return false;
    }
  }) || null;
}

function scraperForId(novelId) {
  if (!novelId) return null;
  return SCRAPERS.find((scraper) => novelId.startsWith(`${scraper.SOURCE_ID}_`)) || null;
}

function allSourceIds() {
  return SCRAPERS.map((scraper) => scraper.SOURCE_ID);
}

module.exports = {
  SCRAPERS,
  scraperForUrl,
  scraperForId,
  allSourceIds,
};
