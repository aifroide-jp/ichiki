'use strict';

// モックのページ群から「実サイト上の URL」を導く。**唯一の実装。**
//
// なぜ必要か:
//   モックのファイルパスから URL を組み立ててはいけない。
//   実測: about/biodiversity.html は data-page-id が about_biodiversity になり、
//   WordPress のスラッグは about-biodiversity（階層が畳まれる）。
//   パスから /about/biodiversity/ を期待すると 404 になるが、
//   **サイト内のリンクはパーマリンク経由なので壊れていない**。検査だけが誤検出する。
//
// なので固定ページは REST で実スラッグを引く。
// verify:live と diff（ピクセル比較）が同じ関数を使う。
// 使わずに手書きの一覧を持たせていた頃は、12ページ中6ページしか比較しておらず
// 取りこぼしに気づけなかった。

// index.html を畳んだ一覧ページのスラッグ（events/index.html → events）
function archiveSlugOf(relPath) {
  return relPath.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1').replace(/\/$/, '');
}

// data-page-id → WordPress のスラッグ（seed-posts.php と同じ規則）
function slugOfPageId(id) {
  return String(id || '').replace(/_/g, '-');
}

// pages: [{ rel, kind, cpt, pageId, variant }]
// fetchJson: (url) => Promise<any>  （呼び手が用意する。取得方法を共有しない）
// onProblem: (kind, message) => void  省略可
async function expandUrls(pages, siteUrl, fetchJson, onProblem) {
  const problem = onProblem || (() => {});
  const archiveSlug = {};
  for (const p of pages) if (p.kind === 'archive') archiveSlug[p.cpt] = archiveSlugOf(p.rel);

  const pageSlugs = new Set();
  {
    const j = await fetchJson(`${siteUrl}/wp-json/wp/v2/pages?per_page=100`);
    if (Array.isArray(j)) for (const x of j) pageSlugs.add(x.slug);
  }

  const postsOf = {};
  for (const cpt of new Set(pages.filter((p) => p.cpt).map((p) => p.cpt))) {
    const j = await fetchJson(`${siteUrl}/wp-json/wp/v2/nkk_${cpt}?per_page=100`);
    postsOf[cpt] = Array.isArray(j) ? j.map((x) => x.slug) : [];
  }

  const targets = [];
  for (const p of pages) {
    if (p.kind === 'front') {
      targets.push({ url: '/', page: p });
    } else if (p.kind === 'page') {
      const slug = slugOfPageId(p.pageId);
      if (slug && !pageSlugs.has(slug)) {
        problem('page-missing', `data-page-id="${p.pageId}" の固定ページが実サイトにありません`, `/${slug}/`);
        continue;
      }
      targets.push({ url: `/${slug}/`, page: p });
    } else if (p.kind === 'archive') {
      targets.push({ url: `/${archiveSlug[p.cpt]}/`, page: p });
    } else if (p.kind === 'single') {
      const base = archiveSlug[p.cpt];
      if (!base) {
        problem('no-archive', `data-cpt="${p.cpt}" の archive ページが無く、URL を導けません`, '(model)');
        continue;
      }
      const slugs = postsOf[p.cpt] || [];
      if (slugs.length === 0) problem('no-post', `nkk_${p.cpt} の投稿が1件もありません`, '(model)');
      for (const s of slugs) {
        targets.push({ url: `/${base}/${s}/${p.variant ? p.variant + '/' : ''}`, page: p });
      }
    }
  }
  return targets;
}

module.exports = { archiveSlugOf, slugOfPageId, expandUrls };
