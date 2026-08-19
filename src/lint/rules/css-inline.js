'use strict';

// L11: ページ内 <style> タグが無い
// L12: style="…" 属性が無い
// L13: class 名・**構造宣言**の data-* 値が全て ASCII (テキストコンテンツは対象外)
// L25: インラインの <script> が無い（L11 と同じ理由）
const { mk } = require('../lib/issue');
const { DECLARATION_ATTRS } = require('../../shared/declaration-attrs');

const NON_ASCII_RE = /[^\x00-\x7F]/;

function run(page) {
  const issues = [];
  const $ = page.$;

  $('style').each((_, el) => {
    issues.push(mk(page, 'L11', 'error', page.lineOf($(el)), '<style> タグは禁止されています(css/ 配下のファイルに分離してください)'));
  });

  // インラインの <script> は変換器がテーマへ持ち出せない（enqueue できない）。
  // 実測: 全10ページに同一のインラインが複製され、その中身はトップ専用のヒーロー
  // スライドショーだった。.hero-slide が無い9ページで Uncaught TypeError になり、
  // 同じブロックの後半（アコーディオン）はそこで死んでいた。
  // 原則4（同じものを2回以上書かない）に照らして、ファイルへの分離を必須にする。
  $('script').each((_, el) => {
    const $el = $(el);
    if ($el.attr('src')) return;
    if (($el.attr('type') || '').includes('json')) return; // 構造化データ等は対象外
    issues.push(
      mk(page, 'L25', 'error', page.lineOf($el), 'インラインの <script> は禁止されています(js/ 配下のファイルに分離してください。ページ固有なら js/page/<ページID>.js)')
    );
  });

  $('[style]').each((_, el) => {
    const $el = $(el);
    issues.push(
      mk(page, 'L12', 'error', page.attrLineOf($el, 'style'), `style="${$el.attr('style')}" のようなインライン style 属性は禁止されています`)
    );
  });

  $('*').each((_, el) => {
    if (!el.attribs) return;
    const $el = $(el);
    for (const [attrName, value] of Object.entries(el.attribs)) {
      // 対象は class 名と**構造宣言の値**のみ。
      // サイト自身の JS が使う data-*（例: フィルタの data-category="生態系保全"）は
      // PHP 変数にも ACF キーにもならないので対象外。以前は data- で始まる全部を
      // 見ており、正当な日本語の値を27件も誤検出していた。
      if (attrName !== 'class' && !DECLARATION_ATTRS.has(attrName)) continue;
      // data-cf7-group-if は「event_target=子ども」のように**比較する内容そのもの**を書く。
      // 識別子ではないので PHP 変数名にも ACF キーにもならず、日本語で正しい（6.2節）。
      if (attrName === 'data-cf7-group-if') continue;
      if (NON_ASCII_RE.test(value)) {
        issues.push(
          mk(page, 'L13', 'error', page.attrLineOf($el, attrName), `${attrName}="${value}" に ASCII 以外の文字が含まれています`)
        );
      }
    }
  });

  return issues;
}

module.exports = { run };
