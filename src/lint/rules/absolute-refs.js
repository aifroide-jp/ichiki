'use strict';

// L21: 内部参照がルート絶対パス("/"始まり)でないこと
//
// vocabulary.md §7/§8: 内部参照はすべて相対パスで書く。モックは単体で開いて
// 閲覧・回遊できる必要があるため、ブラウザで file:// として開くと解決できない
// ルート絶対パス("/css/..." 等)は禁止する。
// 検査対象: <link href>, <img src>, <a href>。
// 対象外: 外部URL(http(s)://, //)・mailto:・tel:・#アンカー。
const { mk } = require('../lib/issue');

function isExemptScheme(value) {
  return /^(#|https?:\/\/|\/\/|mailto:|tel:)/i.test(value);
}

function isRootAbsolutePath(value) {
  if (isExemptScheme(value)) return false;
  return value.startsWith('/');
}

function checkAttr(page, $el, attrName, issues) {
  const value = $el.attr(attrName);
  if (value === undefined) return;
  if (isRootAbsolutePath(value)) {
    const line = page.attrLineOf($el, attrName);
    const tag = $el.get(0) && $el.get(0).tagName;
    issues.push(
      mk(
        page,
        'L21',
        'error',
        line,
        `<${tag} ${attrName}="${value}"> がルート絶対パスです(相対パスにしてください)`
      )
    );
  }
}

function run(page) {
  const issues = [];
  const $ = page.$;

  $('link[href]').each((_, el) => checkAttr(page, $(el), 'href', issues));
  $('img[src]').each((_, el) => checkAttr(page, $(el), 'src', issues));
  $('a[href]').each((_, el) => checkAttr(page, $(el), 'href', issues));

  return issues;
}

module.exports = { run, isRootAbsolutePath };
