'use strict';

function normalizeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractDates(html) {
  const text = String(html || '');
  const publishedMatch = text.match(/(?:datePublished|published_time)["':\s]+([^"',<]+)/i);
  const updatedMatch = text.match(/(?:dateModified|modified_time|updated_time)["':\s]+([^"',<]+)/i);

  return {
    updatedAt: normalizeDate(updatedMatch?.[1]),
    publishedAt: normalizeDate(publishedMatch?.[1]),
  };
}

module.exports = { extractDates };
