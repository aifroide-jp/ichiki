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
function parseCptRewriteSlugs(functionsPhp) {
  const cpts = [];
  const re = /register_post_type\(\s*'([^']+)'[\s\S]*?'rewrite'\s*=>\s*\[\s*'slug'\s*=>\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(functionsPhp))) {
    cpts.push({ postType: m[1], slug: m[2] });
  }
  // 長いslugを先に判定できるよう長さ降順（'network/cases' を 'network' より先に見る）
  cpts.sort((a, b) => b.slug.length - a.slug.length);
  return cpts;
}

// inc/seed-posts.php から固定ページ定義（$pages）を抽出する
function parseFixedPages(seedPostsPhp) {
  const pages = [];
  const re = /\[\s*'title'\s*=>\s*'((?:[^'\\]|\\.)*)'\s*,\s*'slug'\s*=>\s*'([^']+)'\s*,\s*'template'\s*=>\s*'([^']*)'(?:\s*,\s*'parent_slug'\s*=>\s*'([^']+)')?\s*\]/g;
  let m;
  while ((m = re.exec(seedPostsPhp))) {
    pages.push({ title: m[1], slug: m[2], template: m[3] || '', parentSlug: m[4] || null });
  }
  return pages;
}

// inc/seed-posts.php から nkk_seed_post() 呼び出し（CPT投稿）を抽出する
function parseSeedCptPosts(seedPostsPhp) {
  const posts = [];
  const re = /nkk_seed_post\(\s*\[\s*'post_title'\s*=>\s*'((?:[^'\\]|\\.)*)'\s*,\s*'post_type'\s*=>\s*'([^']+)'\s*,\s*'post_name'\s*=>\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(seedPostsPhp))) {
    posts.push({ title: m[1], postType: m[2], postName: m[3] });
  }
  return posts;
}

// mockup の file パスから WP 側の URL パスを導出する（末尾 index.html は畳む）
function deriveUrlPath(file) {
  let p = file.replace(/index\.html$/, '').replace(/\.html$/, '');
  if (!p.endsWith('/')) p += '/';
  if (!p.startsWith('/')) p = '/' + p;
  return p;
}

function trimSlashes(s) {
  return s.replace(/^\/+|\/+$/g, '');
}

function buildThemeModel({ acfMapPath, themeDir, siteUrl }) {
  const acfMap = yaml.load(readFile(acfMapPath));
  const functionsPhp = readFile(path.join(themeDir, 'functions.php'));
  const seedPostsPath = path.join(themeDir, 'inc', 'seed-posts.php');
  const seedPostsPhp = fs.existsSync(seedPostsPath) ? readFile(seedPostsPath) : '';

  const cptSlugs = parseCptRewriteSlugs(functionsPhp);
  const fixedPages = parseFixedPages(seedPostsPhp);
  const seedCptPosts = parseSeedCptPosts(seedPostsPhp);

  const fixedBySlug = new Map(fixedPages.map(p => [trimSlashes(p.slug), p]));
  const archiveTemplateByPageSlug = { news: 'nkk_news', events: 'nkk_event' };

  const pages = (acfMap.pages || []).map(page => {
    const urlPath = deriveUrlPath(page.file);
    const trimmed = trimSlashes(urlPath);

    if (page.id === 'index') {
      return {
        ...page,
        urlPath: '/',
        liveUrl: siteUrl.replace(/\/$/, '') + '/',
        kind: 'front',
        template: 'front-page.php',
        cpt: null,
        unresolved: false,
      };
    }

    const fixed = fixedBySlug.get(trimmed);
    if (fixed) {
      const isArchive = fixed.template === '';
      return {
        ...page,
        urlPath,
        liveUrl: siteUrl.replace(/\/$/, '') + urlPath,
        kind: isArchive ? 'archive' : 'page',
        template: isArchive ? `archive-${archiveTemplateByPageSlug[trimmed] || '?'}.php` : fixed.template,
        cpt: isArchive ? (archiveTemplateByPageSlug[trimmed] || null) : null,
        unresolved: isArchive && !archiveTemplateByPageSlug[trimmed],
      };
    }

    // 固定ページに無い → CPT 詳細（single）候補。rewrite slug の前方一致で CPT を特定する
    const cptMatch = cptSlugs.find(c => trimmed === c.slug || trimmed.startsWith(c.slug + '/'));
    if (cptMatch) {
      const postName = trimmed.slice(cptMatch.slug.length).replace(/^\/+/, '');
      const seedHit = seedCptPosts.find(sp => sp.postType === cptMatch.postType && sp.postName === postName);
      return {
        ...page,
        urlPath,
        liveUrl: siteUrl.replace(/\/$/, '') + urlPath,
        kind: 'cpt-single',
        template: `single-${cptMatch.postType}.php`,
        cpt: cptMatch.postType,
        postName,
        unresolved: !seedHit, // seed-posts.php に対応する投稿が見つからない場合は要確認
      };
    }

    return {
      ...page,
      urlPath,
      liveUrl: siteUrl.replace(/\/$/, '') + urlPath,
      kind: 'unknown',
      template: null,
      cpt: null,
      unresolved: true,
    };
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

  return { acfMap, pages, cptSlugs, fixedPages };
}

// テストケースとして出力する対象（CPT の非representativeは除外）
function testCasePages(pages) {
  return pages.filter(p => p.kind !== 'cpt-single' || p.representative);
}

// representative の裏にいる collapsed メンバー一覧（透明性のため付録に出す）
function collapsedMembersOf(pages, repId) {
  return pages.filter(p => p.kind === 'cpt-single' && p.representativeOf === repId);
}

module.exports = { buildThemeModel, testCasePages, collapsedMembersOf, deriveUrlPath };
