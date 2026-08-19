'use strict';

// L01: <body> に data-page がある
// L02: data-page="page" に data-page-id がある / archive・single に data-cpt がある
// L07: data-loop 直下の data-loop-item がちょうど1個
// L19: <section> に class か data-* のいずれか(両方ではない)がある
const { mk } = require('../lib/issue');
const { VALID_DATA_PAGE } = require('../lib/constants');

function run(page) {
  const issues = [];
  const $ = page.$;
  const body = $('body');

  if (body.length === 0) {
    issues.push(mk(page, 'L01', 'error', 1, '<body> が見つかりません'));
    return issues;
  }

  const bodyLine = page.lineOf(body);
  const dataPage = body.attr('data-page');

  if (dataPage === undefined) {
    issues.push(mk(page, 'L01', 'error', bodyLine, '<body> に data-page がありません'));
  } else if (!VALID_DATA_PAGE.includes(dataPage)) {
    issues.push(
      mk(
        page,
        'L01',
        'error',
        page.attrLineOf(body, 'data-page'),
        `data-page="${dataPage}" は無効な値です(front/page/archive/single のいずれか)`
      )
    );
  }

  if (dataPage === 'page' && body.attr('data-page-id') === undefined) {
    issues.push(mk(page, 'L02', 'error', bodyLine, 'data-page="page" ですが data-page-id がありません'));
  }
  if ((dataPage === 'archive' || dataPage === 'single') && body.attr('data-cpt') === undefined) {
    issues.push(mk(page, 'L02', 'error', bodyLine, `data-page="${dataPage}" ですが data-cpt がありません`));
  }

  // L07: data-loop 直下(直接の子)の data-loop-item はちょうど1個
  $('[data-loop]').each((_, el) => {
    const $el = $(el);
    const items = $el.children('[data-loop-item]');
    const line = page.lineOf($el);
    if (items.length !== 1) {
      issues.push(
        mk(
          page,
          'L07',
          'error',
          line,
          `data-loop="${$el.attr('data-loop')}" 直下の data-loop-item が${items.length}個です(ちょうど1個である必要があります)`
        )
      );
    }
  });

  // L19: <section> に class か data-* の少なくとも一方がある(両方あってよい)
  $('section').each((_, el) => {
    const attribs = el.attribs || {};
    const hasClass = Object.prototype.hasOwnProperty.call(attribs, 'class');
    const hasDataAttr = Object.keys(attribs).some((k) => k.startsWith('data-'));
    const line = page.lineOf($(el));
    if (!hasClass && !hasDataAttr) {
      issues.push(mk(page, 'L19', 'error', line, '<section> に class も data-* もありません(命名の手がかりがありません)'));
    }
  });

  // L26: <section> に data-section がある
  //
  // 「宣言を間違えて書いた」ではなく「書き忘れた」を捕まえるためのルール。
  // 書き忘れは静かに失敗する: 変換は成功するが acf-map.yaml のセクション分けが
  // 失われるだけなので、モックを見ても生成物を見ても気づけない。
  //
  // 除外するもの:
  //   - data-common 配下（ヘッダー/フッター/CTA はセクションではなく共通領域）
  //   - data-loop-item / data-loop-sample 配下（カードの中身であって、ページのセクションではない）
  $('section').each((_, el) => {
    const $el = $(el);
    if ($el.attr('data-section') !== undefined) return;
    if ($el.closest('[data-common], [data-loop-item], [data-loop-sample]').length > 0) return;
    if ($el.attr('data-common') !== undefined) return;
    issues.push(
      mk(
        page,
        'L26',
        'error',
        page.lineOf($el),
        '<section> に data-section がありません(acf-map.yaml の sections[].id になります。2.5節)'
      )
    );
  });

  // L27: 同じ中身の子を複数持つ data-loop に data-loop-repeat がある
  //
  // CSS で translateX して繋ぐ無限マーキーは、DOM に N 周ぶんのカードが無いと繋がらない。
  // モックには複製が直接書いてあるので見た目は正しいが、変換後は実データが1周ぶんしか
  // 出ないため、宣言が無いと**生成物だけが途切れる**。モックを見ても気づけない壊れ方。
  //
  // 判定: 子要素のテキスト署名に重複があれば「複製されている」とみなす。
  // 一覧のカードは本来すべて別内容なので、完全一致する子が2つ以上あるのは複製しかない。
  $('[data-loop]').each((_, el) => {
    const $l = $(el);
    const line = page.lineOf($l);
    const sigs = $l
      .children()
      .map((_i, c) => $(c).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter((s) => s !== '');
    const unique = new Set(sigs);
    const hasDup = unique.size !== sigs.length;
    const repeatAttr = $l.attr('data-loop-repeat');

    if (hasDup && repeatAttr === undefined) {
      issues.push(
        mk(
          page,
          'L27',
          'error',
          line,
          `data-loop="${$l.attr('data-loop')}" に同じ中身の子が複数ありますが data-loop-repeat がありません` +
            `(無限マーキー等の複製なら周回数を宣言してください。宣言しないと生成物だけが途切れます。3.1節)`
        )
      );
      return;
    }
    if (repeatAttr === undefined) return;

    // 宣言があるなら、実際の複製数と一致しているかまで見る。
    // ずれていると「モックは2周ぶん・生成物は3周ぶん」のような食い違いが起きる。
    const n = parseInt(repeatAttr, 10);
    if (!Number.isInteger(n) || n < 1) {
      issues.push(mk(page, 'L27', 'error', line, `data-loop-repeat="${repeatAttr}" は1以上の整数で指定してください`));
      return;
    }
    if (sigs.length !== unique.size * n) {
      issues.push(
        mk(
          page,
          'L27',
          'error',
          line,
          `data-loop-repeat="${n}" ですが、子要素は ${sigs.length}個・うち異なる中身は ${unique.size}種類です` +
            `(${unique.size} × ${n} = ${unique.size * n} 個であるべき)`
        )
      );
    }
  });

  return issues;
}

module.exports = { run };
