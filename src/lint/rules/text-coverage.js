'use strict';

// L20 (warn): data-acf の無いテキストノードの一覧(=更新対象外になる文言)。
// 運用上いちばん重要なレポートのため、件数だけでなく実際の文字列・file:line を全件出す。
//
// 分類そのものは src/shared/text-classify.js が唯一の実装。
// scan の取りこぼし検証（coverage）と同じ関数を使うので、
// 「lint L20 の集合」と「scan の unclaimed」は定義上一致する。
// 以前は別実装で18件ずれていた。
const { mk } = require('../lib/issue');
const { classifyPage } = require('../../shared/text-classify');

function run(page) {
  const body = page.$('body').get(0);
  const { unclaimed } = classifyPage(body);
  return unclaimed.map((u) => mk(page, 'L20', 'warn', u.line, `data-acf の無いテキスト: "${u.text}"`));
}

module.exports = { run };
