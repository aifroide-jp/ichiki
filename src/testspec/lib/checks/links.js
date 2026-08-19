'use strict';
const { fetchUrl } = require('./http');

function isCheckable(href) {
  if (!href) return false;
  if (href.startsWith('#')) return false;
  if (/^(mailto|tel|javascript):/i.test(href)) return false;
  return true;
}

function resolveUrl(href, siteUrl) {
  const origin = siteUrl.replace(/\/$/, '');
  if (href.startsWith('/')) return origin + href;
  if (href.startsWith(origin)) return href;
  return null; // 外部ドメイン・相対パス（mockup内相対リンク等）は対象外
}

async function checkLinks(page, siteUrl) {
  const fetched = await fetchUrl(page.liveUrl);
  const body = fetched.body || '';

  const hrefs = new Set();
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(body))) {
    if (isCheckable(m[1])) hrefs.add(m[1]);
  }

  const targets = new Set();
  for (const href of hrefs) {
    const url = resolveUrl(href, siteUrl);
    if (url) targets.add(url);
  }

  const broken = [];
  let checked = 0;
  for (const url of targets) {
    checked++;
    const res = await fetchUrl(url);
    if (!res.ok) broken.push({ href: url, status: res.status });
  }

  return { checked, broken };
}

module.exports = { checkLinks };
