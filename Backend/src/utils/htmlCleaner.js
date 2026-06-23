'use strict';

const cheerio = require('cheerio');
const { extractDates } = require('./dateExtractor');

const CONTENT_SELECTORS = [
  '.post-body.entry-content',
  '.post-body',
  'article',
  '.entry-content',
  '.chapter-content',
];

function removeNoise($, root) {
  root
    .find('script, style, iframe, noscript, nav, header, footer, .ads, .ad-wrap, [class*="adsbygoogle"], [id*="adsbygoogle"]')
    .remove();

  root.find('a').each((_, node) => {
    const text = $(node).text().trim();
    if (/^(<<|prev|previous|sebelumnya|daftar\s*(isi|chapter|bab)|selanjutnya|next)/i.test(text)) {
      $(node).remove();
    }
  });

  root.find('p, div, center').each((_, node) => {
    const text = $(node).text().trim();
    if (!text || /^[|\s]+$/.test(text)) $(node).remove();
  });
}

function extractChapterHtml(html) {
  const raw = String(html || '');
  const $ = cheerio.load(raw, { decodeEntities: false });
  let root = null;

  for (const selector of CONTENT_SELECTORS) {
    const candidate = $(selector).first();
    if (candidate.length) {
      root = candidate.clone();
      break;
    }
  }

  if (!root) root = $('body').clone();
  removeNoise($, root);

  return {
    htmlContent: root.html() || '',
    ...extractDates(raw),
  };
}

module.exports = { extractChapterHtml };
