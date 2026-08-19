'use strict';

const fs = require('fs');
const cheerio = require('cheerio');

// 1ファイル分のパース結果。$ は cheerio インスタンス（sourceCodeLocationInfo 有効）。
function loadPage(absPath, relPath) {
  const html = fs.readFileSync(absPath, 'utf8');
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });

  // cheerio/parse5 の sourceCodeLocation は 1-based の startLine を持つ。
  // 属性単位の位置が取れないケースのフォールバックとしてタグ開始行を返す。
  function lineOf(el) {
    if (!el) return null;
    const loc = el.sourceCodeLocation || (el[0] && el[0].sourceCodeLocation);
    if (!loc) return null;
    return loc.startLine;
  }

  function attrLineOf(el, attrName) {
    const node = el && el[0] ? el[0] : el;
    const loc = node && node.sourceCodeLocation;
    if (loc && loc.attrs && loc.attrs[attrName]) {
      return loc.attrs[attrName].startLine;
    }
    return lineOf(node);
  }

  return { absPath, relPath, html, $, lineOf, attrLineOf };
}

module.exports = { loadPage };
