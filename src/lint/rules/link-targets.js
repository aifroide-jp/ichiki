'use strict';

// L30: モック内リンクの行き先が実在する／どこからも辿れないページが無い
//
// なぜ lint の仕事か:
//   行き先の検査は変換器も持っているが、**data-nav の中は対象外**になっている
//   （ナビは中身を丸ごと wp_nav_menu() へ置換するため、href を解決しない）。
//   そのため実測で、グローバルナビが参照する10施設のうち9件がモックに存在せず、
//   seed が項目を黙って落として **25本のはずのナビが15本**になっていた。
//   変換器も seed も何も言わず、生成後のサイトを数えて初めて気づいた。
//
//   書いている段階で分かることは、書いている段階で止める。
//
// 裏返しの検査（孤立ページ）も同じ整合性の話なので、ここで一緒に見る。
// どこからもリンクされていないページは、リンク切れの逆側の不整合である。

const path = require('path');
const { mk } = require('../lib/issue');

function isExternal(v) {
  return /^(#|https?:\/\/|\/\/|mailto:|tel:|javascript:|data:)/i.test(v);
}

// href をモックルートからのサイトパスへ正規化する。
// index.html はディレクトリに畳む（vocabulary.md 1章のページID規則と揃える）。
function toSitePath(href, fromRel) {
  const clean = String(href).split('#')[0].split('?')[0];
  if (clean === '') return null;
  const base = path.posix.dirname(fromRel.split(path.sep).join('/'));
  const joined = clean.startsWith('/')
    ? clean.replace(/^\/+/, '')
    : path.posix.normalize(path.posix.join(base === '.' ? '' : base, clean));
  if (joined.startsWith('..')) return joined; // ルートの外。呼び出し側でエラーにする
  return joined.replace(/\/index\.html$/, '/').replace(/^\.\//, '');
}

// モックのファイルパスを、リンクから見た表記に正規化する
function pageKeys(rel) {
  const r = rel.split(path.sep).join('/');
  const keys = new Set([r]);
  if (r.endsWith('/index.html')) keys.add(r.slice(0, -'index.html'.length));
  if (r === 'index.html') keys.add('');
  return keys;
}

function run(pages) {
  const issues = [];

  // 同じ行き先は1件にまとめる。
  // ヘッダー・フッター・モバイルナビは全ページに出るので、素直に数えると
  // 1つの未解決リンクが11ページ分に膨らみ、実測で34種類が639件になって読めなくなる。
  // 「どこを直せばよいか」は行き先ごとに1件あれば足りる。
  const reportedTargets = new Set();

  // モックに実在するページの集合
  const exists = new Set();
  for (const p of pages) for (const k of pageKeys(p.relPath)) exists.add(k);

  // 到達できたページ（孤立検出用）
  const reached = new Set();

  for (const page of pages) {
    const $ = page.$;
    $('a[href]').each((_, a) => {
      const href = $(a).attr('href');
      if (!href || isExternal(href)) return;

      const target = toSitePath(href, page.relPath);
      if (target === null) return;

      if (target.startsWith('..')) {
        issues.push(
          mk(page, 'L30', 'error', page.attrLineOf($(a), 'href'), `href="${href}" がモックの外を指しています`)
        );
        return;
      }
      if (!exists.has(target)) {
        if (!reportedTargets.has(target)) {
          reportedTargets.add(target);
          const issue = mk(
            page,
            'L30',
            'error',
            page.attrLineOf($(a), 'href'),
            `href="${href}" の行き先がモックにありません（"${target}"）。` +
              `ページを追加するか、リンクを外してください（同じ行き先の他の箇所は省略）`
          );
          // 変換器の --allow-unresolved-links と同じ事実（モックが未完成）を指すので、
          // そのオプションが渡されたときだけ警告に落とせる印を付ける。
          issue.unresolvedLink = true;
          issues.push(issue);
        }
        return;
      }
      reached.add(target);
    });
  }

  // 孤立ページ: どこからもリンクされていない。
  // front は入口なので除く。リンク切れの裏返しで、同じ整合性の欠落。
  for (const page of pages) {
    if (page.dataPage === 'front') continue;
    const keys = [...pageKeys(page.relPath)];
    if (keys.some((k) => reached.has(k))) continue;
    issues.push(
      mk(page, 'L30', 'warn', 1, 'このページへのリンクがモック内のどこにもありません（孤立ページ）')
    );
  }

  return issues;
}

module.exports = { run };
