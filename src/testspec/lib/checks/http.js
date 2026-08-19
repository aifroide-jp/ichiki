'use strict';
// ライブサイトへのHTTPフェッチを一度きりにするための簡易キャッシュ
const cache = new Map();

function fetchUrl(url, { timeout = 8000 } = {}) {
  if (cache.has(url)) return cache.get(url);
  const promise = (async () => {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout) });
      const body = await res.text();
      return { ok: res.ok, status: res.status, body, finalUrl: res.url };
    } catch (e) {
      return { ok: false, status: 0, body: '', finalUrl: url, error: e.message };
    }
  })();
  cache.set(url, promise);
  return promise;
}

module.exports = { fetchUrl };
