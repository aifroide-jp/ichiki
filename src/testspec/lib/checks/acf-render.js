'use strict';
const { fetchUrl } = require('./http');

async function checkAcfRender(page, siteUrl) {
  const fetched = await fetchUrl(page.liveUrl);
  const body = fetched.body || '';

  let total = 0;
  let matched = 0;
  let excludedImages = 0;
  const missing = [];

  for (const section of page.sections || []) {
    for (const field of section.fields || []) {
      if (field.type === 'image') { excludedImages++; continue; }
      if (field.type !== 'text' && field.type !== 'textarea') continue;
      const raw = field.default;
      if (raw === undefined || raw === null) continue;
      const value = String(raw).trim();
      if (value === '') continue;

      total++;
      if (body.includes(value)) {
        matched++;
        continue;
      }
      const head = value.slice(0, 20);
      if (head && body.includes(head)) {
        matched++;
        continue;
      }
      missing.push({ field_name: field.field_name, default: value });
    }
  }

  return { total, matched, missing, excludedImages };
}

module.exports = { checkAcfRender };
