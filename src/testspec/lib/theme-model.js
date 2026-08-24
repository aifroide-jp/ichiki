'use strict';
/**
 * acf-map.yaml + テーマ側 functions.php / inc/seed-posts.php を読み合わせて
 * 「ページ1件 = テストケース1件」の単位でページモデルを組み立てる。
 *
 * - 固定ページ / トップページ → 1ページ = 1テストケース
 * - CPT（一覧→詳細のパターン）→ 詳細テンプレートを共有する members のうち
 *   先頭1件だけを representative としてテストケース化し、残りは
 *   representativeOf で参照だけ残す（volume 対策。中身は隠さず注記する）
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

// functions.php から CPT の rewrite slug を抽出する

// inc/seed-posts.php から固定ページ定義（$pages）を抽出する
function parseFixedPages(seedPostsPhp) {
  // 変換器が出す形:
  //   nkk_seed_get_or_create( 'page', '<slug>', '<title>', '<template>' );
  //   nkk_seed_get_or_create( 'page', '<slug>', '<title>' );            テンプレ無し
  // 以前は旧テーマの書き方（['title'=>…,'slug'=>…] の配列）を前提にしていて、
  // 変換器が出したテーマでは**1件も拾えなかった**（実測: 固定ページが全部「種別不明」）。
  const pages = [];
  const re = /nkk_seed_get_or_create\(\s*'page'\s*,\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*(?:,\s*'([^']*)'\s*)?\)/g;
  let m;
  while ((m = re.exec(seedPostsPhp))) {
    pages.push({ slug: m[1], title: m[2], template: m[3] || '', parentSlug: null });
  }
  return pages;
}

// inc/seed-posts.php から CPT の初期投稿を抽出する
function parseSeedCptPosts(seedPostsPhp) {
  // 変換器が出す形: nkk_seed_get_or_create( 'nkk_<cpt>', '<post_name>', '<title>' );
  const posts = [];
  const re = /nkk_seed_get_or_create\(\s*'(nkk_[a-z0-9_]+)'\s*,\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(seedPostsPhp))) {
    posts.push({ postType: m[1], postName: m[2], title: m[3] });
  }
  return posts;
}

// mockup の file パスから WP 側の URL パスを導出する（末尾 index.html は畳む）

function trimSlashes(s) {
  return s.replace(/^\/+|\/+$/g, '');
}

function buildThemeModel({ acfMapPath, themeDir, siteUrl }) {
  const acfMap = yaml.load(readFile(acfMapPath));
  const seedPostsPath = path.join(themeDir, 'inc', 'seed-posts.php');
  const seedPostsPhp = fs.existsSync(seedPostsPath) ? readFile(seedPostsPath) : '';

  const fixedPages = parseFixedPages(seedPostsPhp);
  const seedCptPosts = parseSeedCptPosts(seedPostsPhp);

  const fixedBySlug = new Map(fixedPages.map(p => [trimSlashes(p.slug), p]));

  // ページ種別は**台帳の宣言をそのまま読む**。
  //
  // 以前はテーマの PHP を正規表現で解析して推測していた（functions.php の
  // rewrite slug、seed-posts.php の固定ページ、ファイルパスからの URL 組み立て）。
  // 加えて archiveTemplateByPageSlug = { news:'nkk_news', events:'nkk_event' } と
  // **案件固有の対応表が焼き込まれていた**。
  // 制約語彙の台帳には page_type / page_id / cpt / variant が入っているので、
  // 推測する理由が無い（実測: 旧方式では12ページ中11ページが「種別不明」になった）。
  //
  // URL は seed-posts.php と同じ規則で導く。固定ページのスラッグは
  // data-page-id の _ を - に置換したもの（階層は畳まれる）。
  const archiveSlugOfCpt = {};
  for (const page of acfMap.pages || []) {
    if (page.page_type === 'archive' && page.cpt) {
      archiveSlugOfCpt[page.cpt] = trimSlashes(
        page.file.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1')
      );
    }
  }
  const abs = (u) => siteUrl.replace(/\/$/, '') + u;

  const pages = (acfMap.pages || []).map(page => {
    const seedName = (cpt) => {
      const hit = seedCptPosts.find((sp) => sp.postType === `nkk_${cpt}`);
      return hit ? hit.postName : null;
    };

    if (page.page_type === 'front') {
      return { ...page, urlPath: '/', liveUrl: abs('/'), kind: 'front', template: 'front-page.php', cpt: null, unresolved: false };
    }

    if (page.page_type === 'page') {
      const slug = String(page.page_id || '').replace(/_/g, '-');
      const urlPath = `/${slug}/`;
      return {
        ...page,
        urlPath,
        liveUrl: abs(urlPath),
        kind: 'page',
        template: `page-${page.page_id}.php`,
        cpt: null,
        // seed が作る固定ページに無ければ、実サイトに存在しない
        unresolved: !fixedBySlug.has(slug),
      };
    }

    if (page.page_type === 'archive') {
      const slug = archiveSlugOfCpt[page.cpt];
      const urlPath = `/${slug}/`;
      return { ...page, urlPath, liveUrl: abs(urlPath), kind: 'archive', template: `archive-nkk_${page.cpt}.php`, cpt: `nkk_${page.cpt}`, unresolved: !slug };
    }

    if (page.page_type === 'single') {
      const base = archiveSlugOfCpt[page.cpt];
      const postName = seedName(page.cpt);
      const urlPath = base && postName ? `/${base}/${postName}/${page.variant ? page.variant + '/' : ''}` : null;
      return {
        ...page,
        urlPath: urlPath || '',
        liveUrl: urlPath ? abs(urlPath) : '',
        kind: 'cpt-single',
        template: page.variant ? `single-nkk_${page.cpt}-${page.variant}.php` : `single-nkk_${page.cpt}.php`,
        cpt: `nkk_${page.cpt}`,
        postName,
        // 一覧ページが無い（URL を導けない）か、seed に投稿が無い
        unresolved: !urlPath,
      };
    }

    return { ...page, urlPath: '', liveUrl: '', kind: 'unknown', template: null, cpt: null, unresolved: true };
  });

  // CPT グループごとに representative を1件選び、残りは collapsed 扱いにする
  const groupFirstSeen = new Map();
  for (const p of pages) {
    if (p.kind !== 'cpt-single') continue;
    if (!groupFirstSeen.has(p.cpt)) groupFirstSeen.set(p.cpt, p.id);
  }
  for (const p of pages) {
    if (p.kind !== 'cpt-single') continue;
    const repId = groupFirstSeen.get(p.cpt);
    p.representative = p.id === repId;
  }
  for (const p of pages) {
    if (p.kind === 'cpt-single' && !p.representative) {
      const rep = pages.find(x => x.id === groupFirstSeen.get(p.cpt));
      p.representativeOf = rep ? rep.id : null;
    }
  }

  return { acfMap, pages, fixedPages };
}

// テストケースとして出力する対象（CPT の非representativeは除外）
function testCasePages(pages) {
  return pages.filter(p => p.kind !== 'cpt-single' || p.representative);
}

// representative の裏にいる collapsed メンバー一覧（透明性のため付録に出す）
function collapsedMembersOf(pages, repId) {
  return pages.filter(p => p.kind === 'cpt-single' && p.representativeOf === repId);
}

module.exports = { buildThemeModel, testCasePages, collapsedMembersOf };
