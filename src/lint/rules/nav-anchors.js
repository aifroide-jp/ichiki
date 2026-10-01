'use strict';

// L33: #xxx だけのリンクを持つ data-nav が、2ページ以上に出てこない
//
// なぜ要るか:
//   変換器はメニューの #worries を「そのナビが書かれたページ」のアンカーとして
//   URL にする（gen/menus.js）。WordPress のメニューは全ページで同じ URL を出すので、
//   どのページのアンカーかを1つに決めないと登録できない。
//
//   同じナビが複数のページにあると、モックでは各ページの #worries が
//   **そのページ自身**を指している。変換器は最初に出てきたページを採るので、
//   2ページ目以降では行き先が黙って変わる。
//
//   どのページのアンカーかは書いた人にしか分からないので、明示してもらう
//   （index.html#worries のように行き先のページを書く）。
//
// '#' だけのリンク（子を持つ親の飾り等）はどこも指さないので対象外。

const { mk } = require('../lib/issue');

function run(pages) {
  const issues = [];
  const navPages = new Map(); // data-nav の値 -> そのナビがあるページの一覧（出現順）

  for (const page of pages) {
    const $ = page.$;
    $('[data-nav]').each((_, el) => {
      const name = $(el).attr('data-nav');
      const list = navPages.get(name) || [];
      if (!list.some((x) => x.page === page)) list.push({ page, el });
      navPages.set(name, list);
    });
  }

  for (const [name, list] of navPages) {
    if (list.length < 2) continue;
    const { page, el } = list[0];
    const $ = page.$;
    const others = list.slice(1).map((x) => x.page.relPath).join(', ');
    const reported = new Set();
    $(el)
      .find('a[href]')
      .each((_, a) => {
        const href = $(a).attr('href') || '';
        if (!href.startsWith('#') || href.length < 2 || reported.has(href)) return;
        reported.add(href);
        issues.push(
          mk(
            page,
            'L33',
            'error',
            page.attrLineOf($(a), 'href'),
            `data-nav="${name}" の href="${href}" がどのページのアンカーか決まりません` +
              `（このナビは ${others} にもあります）。行き先のページを書いてください（例: ${page.relPath}${href}）`
          )
        );
      });
  }

  return issues;
}

module.exports = { run };
