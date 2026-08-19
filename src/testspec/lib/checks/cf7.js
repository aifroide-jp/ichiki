'use strict';
const { fetchUrl } = require('./http');

async function checkCf7(page, siteUrl) {
  if (!page.forms || page.forms.length === 0) return null;
  const fetched = await fetchUrl(page.liveUrl);
  const body = fetched.body || '';
  return { rendered: body.includes('wpcf7-form') };
}

module.exports = { checkCf7 };
