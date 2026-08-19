'use strict';

// L09: 同じ data-common / data-nav の内容が全ページで一致(バイト単位)。
// ページ横断チェックのため全ページを読んでから判定する。
//
// 比較の単位は「値 × ページ内での出現順」である。値だけでまとめてはいけない。
// 同じメニューを複数の位置に出すのは普通のことで(ヘッダーとフッターに同じ
// data-nav="global" を置く等)、位置ごとに見せ方が違えば内容も違う。これは
// 事故ではなく設計であり、エラーにすると「同じメニューなのに値を分ける」という
// 誤った書き方を強制してしまう(実際にそれで footer が5つに割れた)。
// 検出したいのは「ページ間で共通領域が食い違っている」ことなので、
// 同じ位置(=ページ内の同じ出現順)どうしだけを突き合わせる。
//
// 比較前に href/src の相対パスを「mockupルートからのサイトパス」へ正規化する。
// L21(相対パス化)適用後、同じ共通ヘッダー/フッターでもページの深さによって
// 正しい相対パス表記が変わる(例: ホームリンクは index.html から見て "index.html"、
// about/strategy.html から見て "../index.html")。これは同じリンク先を指す
// 正当な違いであり、共通領域のコンテンツ差分ではないため、正規化してから比較する。
// (絶対パス時代は href が深さに依存せず常に同一文字列だったため、この正規化は不要だった。)
//
// 正規化ロジック本体は src/converter/lib/model.js の同種チェックと共有するため
// src/shared/site-path.js に一本化している。ここでは二重実装しない。
const { mk } = require('../lib/issue');
const { normalizeOuterForCompare } = require('../../shared/site-path');

const TARGET_ATTRS = ['data-common', 'data-nav'];

function run(pages) {
  const issues = [];
  const groups = new Map(); // "attr=value" -> [{page, outer, line, value, attrName}]

  for (const page of pages) {
    const $ = page.$;
    for (const attrName of TARGET_ATTRS) {
      $(`[${attrName}]`).each((occurrence, el) => {
        const $el = $(el);
        const value = $el.attr(attrName);
        const key = `${attrName}=${value}#${occurrence}`;
        const loc = el.sourceCodeLocation;
        const rawOuter = loc ? page.html.slice(loc.startOffset, loc.endOffset) : $.html($el);
        // data-nav-current の除外は normalizeOuterForCompare が行う（shared/site-path.js）
        const outer = normalizeOuterForCompare(rawOuter, page.relPath);
        const line = page.lineOf($el);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ page, outer, line, value, attrName });
      });
    }
  }

  for (const entries of groups.values()) {
    if (entries.length < 2) continue; // 比較対象が他に無い
    const sorted = [...entries].sort((a, b) => a.page.relPath.localeCompare(b.page.relPath));
    const reference = sorted[0];
    for (const entry of sorted.slice(1)) {
      if (entry.outer !== reference.outer) {
        issues.push(
          mk(
            entry.page,
            'L09',
            'error',
            entry.line,
            `${entry.attrName}="${entry.value}" の内容が ${reference.page.relPath}:${reference.line} と一致しません`
          )
        );
      }
    }
  }

  return issues;
}

module.exports = { run };
