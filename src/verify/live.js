#!/usr/bin/env node
'use strict';

// 生成されたサイトを実際に取得して、**モックの宣言と突き合わせる**。
//
//   node proposal/verify-live.js [mockupDir] [siteUrl]
//
// これまでのゲートは全部「入力側」だった:
//   lint             モックが規約に合っているか
//   scan             モックのテキストが漏れていないか
//   verify-coverage  宣言した名前がテンプレートに**文字列として**出ているか
//   verify-structure モックの class が生成物に残っているか
//
// **生成されたサイトが実際に何を出すかを見るものが1つも無かった。**
// そのため全ゲート ✓ のまま、一覧のリンクが全部同じ・カードの中身が全部同じ・
// 応募ボタンの href が空、という状態で通っていた。
//
// モックは「このページに何が出るはずか」を宣言として持っている。
// 生成物を取ってきて突き合わせれば、目視で1ページずつ追う必要が無い。

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = __dirname;
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// パスはカレントディレクトリ基準で解決する（lint / scan / convert と揃える）。
// ROOT 基準にしていたため `proposal/mockup-real` を渡すと
// proposal/proposal/mockup-real を見に行って落ちていた。
const MOCKUP = args[0]
  ? path.resolve(process.cwd(), args[0])
  : path.join(ROOT, 'mockup-real');
const SITE = (args[1] || 'http://localhost:10004').replace(/\/$/, '');
const JSON_MODE = process.argv.includes('--json');

const findings = [];
function bad(url, kind, msg) {
  findings.push({ url, kind, msg });
}

function findHtml(root) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith('.html')) out.push(p);
    }
  })(root);
  return out.sort();
}

// archive ページの場所が CPT の URL スラッグになる（converter/lib/gen/functions.js と同じ規則）
function archiveSlugOf(relPath) {
  return relPath.replace(/\.html$/, '').replace(/(^|\/)index$/, '').replace(/\/$/, '');
}

async function getJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

async function getHtml(url) {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: 0, body: '' };
  }
}

// --- モックを読んで「期待される URL と、そこに出るはずのもの」を組み立てる ----
function readMockup() {
  const pages = [];
  for (const abs of findHtml(MOCKUP)) {
    const rel = path.relative(MOCKUP, abs).split(path.sep).join('/');
    const $ = cheerio.load(fs.readFileSync(abs, 'utf8'));
    const b = $('body');
    const kind = b.attr('data-page');
    if (!kind) continue;

    // 期待される中身
    const loops = [];
    $('[data-loop]').each((_, el) => {
      const $l = $(el);
      loops.push({
        cpt: $l.attr('data-loop'),
        count: parseInt($l.attr('data-loop-count') || '-1', 10),
        repeat: parseInt($l.attr('data-loop-repeat') || '1', 10),
        // 生成物ではループ項目の class がそのまま繰り返される。これを目印に数える。
        itemClass: ($l.children('[data-loop-item]').attr('class') || '').split(/\s+/)[0] || null,
      });
    });

    // data-acf を持つ要素のうち、class で場所を特定できるもの。
    // class は 1:1 で保たれる（verify-structure が保証）ので、実サイト側を引ける。
    const slots = [];
    $('[data-acf]').each((_, el) => {
      const $e = $(el);
      if ($e.closest('[data-loop-sample]').length) return;
      const cls = ($e.attr('class') || '').split(/\s+/)[0];
      if (!cls) return;
      slots.push({ name: $e.attr('data-acf'), cls, inLoop: $e.closest('[data-loop-item]').length > 0 });
    });

    // ナビ: 宣言された位置ごとに、モックに書かれているリンク本数。
    // 実サイトでは wp_nav_menu() が出すので、**メニュー未作成だと 0本になる**。
    // 変換器の責任範囲外だが、検出はできる（サイトとして成立していない状態なので）。
    const navs = [];
    $('[data-nav]').each((_, el) => {
      const $n = $(el);
      const cls = ($n.attr('class') || '').split(/\s+/)[0];
      if (!cls) return;
      navs.push({ location: $n.attr('data-nav'), cls, expect: $n.find('a[href]').length });
    });

    pages.push({
      rel,
      kind,
      cpt: b.attr('data-cpt') || null,
      pageId: b.attr('data-page-id') || null,
      variant: b.attr('data-page-variant') || null,
      loops,
      slots,
      navs,
    });
  }
  return pages;
}

// --- 期待 URL を導く（single は投稿の数だけ増える） -------------------------
async function expandUrls(pages) {
  const archiveSlug = {};
  for (const p of pages) if (p.kind === 'archive') archiveSlug[p.cpt] = archiveSlugOf(p.rel);

  const postsOf = {};
  for (const cpt of new Set(pages.filter((p) => p.cpt).map((p) => p.cpt))) {
    const j = await getJson(`${SITE}/wp-json/wp/v2/nkk_${cpt}?per_page=100`);
    postsOf[cpt] = Array.isArray(j) ? j.map((x) => x.slug) : [];
  }

  const targets = [];
  for (const p of pages) {
    if (p.kind === 'front') targets.push({ url: '/', page: p });
    else if (p.kind === 'page') targets.push({ url: `/${archiveSlugOf(p.rel)}/`, page: p });
    else if (p.kind === 'archive') targets.push({ url: `/${archiveSlug[p.cpt]}/`, page: p });
    else if (p.kind === 'single') {
      const base = archiveSlug[p.cpt];
      if (!base) {
        bad('(model)', 'no-archive', `data-cpt="${p.cpt}" の archive ページが無く、URL を導けません`);
        continue;
      }
      const slugs = postsOf[p.cpt] || [];
      if (slugs.length === 0) bad('(model)', 'no-post', `nkk_${p.cpt} の投稿が1件もありません`);
      for (const s of slugs) {
        targets.push({ url: `/${base}/${s}/${p.variant ? p.variant + '/' : ''}`, page: p });
      }
    }
  }
  return targets;
}

const navReported = new Set();

// --- 1ページを検査する ------------------------------------------------------
function checkPage(url, page, html) {
  const $ = cheerio.load(html);

  // ナビにリンクが出ているか
  for (const nv of page.navs || []) {
    if (navReported.has(nv.location)) continue;
    const $n = $(`.${nv.cls}`);
    if ($n.length === 0) {
      // 宣言したナビが実サイトに**存在しない**。
      // 以前はここで素通りしており、モバイルナビが生成物ごと消えていたのに
      // 検査が何も言わなかった（要素が無いので「リンク0本」にすら到達しない）。
      navReported.add(nv.location);
      bad(url, 'nav-missing', `data-nav="${nv.location}" の要素(.${nv.cls})が実サイトに存在しない`);
      continue;
    }
    const actual = $n.find('a[href]').length;
    if (actual === 0) {
      navReported.add(nv.location);
      bad(url, 'nav-empty', `data-nav="${nv.location}" にリンクが0本（モックは${nv.expect}本）。WPメニューが未作成`);
    } else if (actual < nv.expect) {
      navReported.add(nv.location);
      bad(url, 'nav-short', `data-nav="${nv.location}" のリンクが${actual}本（モックは${nv.expect}本）`);
    }
  }

  // 空のリンク（href="" はブラウザが現在ページとして解釈する。実測でこれが起きていた）
  const emptyHref = $('a[href=""]').length;
  if (emptyHref) bad(url, 'empty-href', `href="" のリンクが ${emptyHref}件（現在ページに戻ってしまう）`);

  // WordPress の URL に .html は存在しない
  $('a[href]').each((_, a) => {
    const h = $(a).attr('href');
    if (/^(https?:)?\/\//.test(h) && !h.includes(SITE.replace(/^https?:\/\//, ''))) return; // 外部
    if (/\.html(\?|#|$)/.test(h)) bad(url, 'html-link', `内部リンクに .html: ${h}`);
  });

  // ループ: 件数・リンクの相違・中身の相違
  for (const lp of page.loops) {
    if (!lp.itemClass) continue;
    const $items = $(`.${lp.itemClass}`);
    const n = $items.length;
    if (n === 0) {
      bad(url, 'loop-empty', `data-loop="${lp.cpt}" のカードが0枚（.${lp.itemClass} が無い）`);
      continue;
    }
    const hrefs = new Set();
    const texts = new Set();
    $items.each((_, el) => {
      const $e = $(el);
      hrefs.add($e.is('a') ? $e.attr('href') : $e.find('a').first().attr('href'));
      texts.add($e.text().replace(/\s+/g, ' ').trim());
    });
    // repeat は同じ並びを N 周出すので、ユニーク数は n/repeat が上限
    const expectUnique = Math.max(1, Math.floor(n / (lp.repeat || 1)));
    if (expectUnique > 1 && hrefs.size < expectUnique) {
      bad(url, 'loop-same-link', `data-loop="${lp.cpt}": ${n}枚のカードの行き先が ${hrefs.size}種類しかない`);
    }
    if (expectUnique > 1 && texts.size < expectUnique) {
      bad(url, 'loop-same-text', `data-loop="${lp.cpt}": ${n}枚のカードの中身が ${texts.size}種類しかない`);
    }
  }

  // data-acf の位置に値が出ているか（class で対応付ける）
  const empties = [];
  for (const s of page.slots) {
    const $t = $(`.${s.cls}`);
    if ($t.length === 0) continue; // 対応する要素が見つからない場合はここでは扱わない
    // 画像フィールドは要素そのものが <img> になる。テキストで判定すると必ず空になるので、
    // 自身が <img src> を持つ場合も「値あり」とみなす（フォールバックも値のうち）。
    const filled = $t.toArray().some((el) => {
      const $e = $(el);
      if ($e.text().trim() !== '') return true;
      if ($e.is('img') && ($e.attr('src') || '') !== '') return true;
      if ($e.find('img').filter((_, im) => ($(im).attr('src') || '') !== '').length > 0) return true;
      // input/textarea 等は value で判定
      if (($e.attr('value') || '') !== '') return true;
      return false;
    });
    if (!filled) empties.push(s.name);
  }
  if (empties.length) {
    bad(url, 'empty-field', `値が空のフィールド ${empties.length}件: ${empties.slice(0, 6).join(', ')}${empties.length > 6 ? ' …' : ''}`);
  }
}

async function main() {
  const pages = readMockup();
  const targets = await expandUrls(pages);

  console.log(`対象サイト: ${SITE}`);
  console.log(`モック ${pages.length}枚 → 期待 URL ${targets.length}本\n`);

  for (const t of targets) {
    const res = await getHtml(SITE + t.url);
    if (res.status !== 200) {
      bad(t.url, 'status', `HTTP ${res.status}`);
      console.log(`✗ ${t.url}  HTTP ${res.status}`);
      continue;
    }
    const before = findings.length;
    checkPage(t.url, t.page, res.body);
    const n = findings.length - before;
    console.log(`${n === 0 ? '✓' : '✗'} ${t.url}${n ? `  (${n}件)` : ''}`);
  }

  console.log('');
  if (JSON_MODE) {
    console.log(JSON.stringify({ findings }, null, 2));
  } else {
    const byKind = {};
    for (const f of findings) (byKind[f.kind] = byKind[f.kind] || []).push(f);
    for (const [k, list] of Object.entries(byKind)) {
      console.log(`--- ${k} (${list.length}件) ---`);
      for (const f of list.slice(0, 8)) console.log(`  ${f.url}  ${f.msg}`);
      if (list.length > 8) console.log(`  … 他 ${list.length - 8}件`);
    }
  }
  console.log('');
  console.log(findings.length === 0 ? 'RESULT: 宣言どおりに出力されています' : `RESULT: ${findings.length}件の不一致`);
  process.exit(findings.length === 0 ? 0 : 1);
}

main();
