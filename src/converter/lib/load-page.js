'use strict';

const fs = require('fs');
const cheerio = require('cheerio');

// 1ファイル分のパース結果。$ は cheerio インスタンス（sourceCodeLocationInfo 有効）。
// html は元のバイト列（文字列）そのもの。編集はすべてこの文字列に対するオフセット操作で行う
// （cheerio の再シリアライズを使わないことで、mockup の HTML 構造・空白・属性順序を
//  編集箇所以外で完全に保持する = vocabulary.md「モックのHTML構造・class名を1:1で保つ」）。
function loadPage(absPath, relPath) {
  const html = fs.readFileSync(absPath, 'utf8');
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });

  function locOf(elOrNode) {
    const node = elOrNode && elOrNode.get ? elOrNode.get(0) : elOrNode;
    return node ? node.sourceCodeLocation : null;
  }

  function lineOf(elOrNode) {
    const loc = locOf(elOrNode);
    return loc ? loc.startLine : null;
  }

  function attrLoc(elOrNode, attrName) {
    const loc = locOf(elOrNode);
    return loc && loc.attrs && loc.attrs[attrName] ? loc.attrs[attrName] : null;
  }

  // <title> は投稿タイトルになる（inc/seed-posts.php）。
  // 読んでいなかったため、固定ページのタイトルが data-page-id そのもの
  // （"contact" / "about_biodiversity"）になり、ブラウザのタブに内部識別子が出ていた。
  // scan 側は同じことを src/scan.js で既にやっている（そちらが先に正しかった）。
  const title = $('title').text().trim();

  return { absPath, relPath, html, $, title, locOf, lineOf, attrLoc };
}

module.exports = { loadPage };
