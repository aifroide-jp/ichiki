'use strict';

// L08: data-loop-item 内の data-acf が対応 CPT 詳細(data-page="single" data-cpt="X")の
// フィールド名に存在する。ページ横断チェックのため全ページを読んでから判定する。
const { mk } = require('../lib/issue');

function run(pages) {
  const issues = [];
  const cptFields = new Map(); // cptSlug -> Set(fieldName)

  for (const page of pages) {
    const $ = page.$;
    const body = $('body');
    if (body.attr('data-page') !== 'single') continue;
    const cpt = body.attr('data-cpt');
    if (!cpt) continue;
    if (!cptFields.has(cpt)) cptFields.set(cpt, new Set());
    const set = cptFields.get(cpt);
    $('[data-acf]').each((_, el) => {
      const name = $(el).attr('data-acf');
      if (name) set.add(name);
    });
  }

  for (const page of pages) {
    const $ = page.$;
    $('[data-loop]').each((_, loopEl) => {
      const $loop = $(loopEl);
      const cpt = $loop.attr('data-loop');
      const known = cptFields.get(cpt);
      if (!known) {
        // 対応する詳細ページが1枚も無い = ループの行き先テンプレートが存在しない。
        // 黙って検証をスキップすると「一覧はあるが詳細が無い」構成ミスを見逃すため error にする。
        issues.push(
          mk(
            page,
            'L08',
            'error',
            page.attrLineOf($loop, 'data-loop'),
            `data-loop="${cpt}" に対応する data-page="single" data-cpt="${cpt}" のページが存在しません`
          )
        );
        return;
      }

      $loop.children('[data-loop-item]').each((_, itemEl) => {
        const $item = $(itemEl);
        const fieldEls = $item.find('[data-acf]').addBack('[data-acf]');
        fieldEls.each((_, fieldEl) => {
          const $field = $(fieldEl);
          const name = $field.attr('data-acf');
          if (name && !known.has(name)) {
            // 一覧カードにしか出てこないフィールドは正当（実例: イベントカードの
            // 「会場 / 要予約」のような要約行。詳細では会場がタグと概要表に分かれており、
            // この1行に当たる要素が無い）。禁止すると「カードのためだけに詳細へ要素を足す」
            // ことになりデザインが歪むため、error ではなく warn で見せるだけにする。
            // 変換器は model.js 4.5 でこのフィールドを CPT に合流させる。
            // ただし誤字も同じ形で現れるので、一覧に出して必ず目に入るようにしておく。
            issues.push(
              mk(
                page,
                'L08',
                'warn',
                page.attrLineOf($field, 'data-acf'),
                `data-acf="${name}" は data-cpt="${cpt}" の詳細ページに出てきません(一覧専用フィールドとして登録されます。名前の書き間違いでないか確認してください)`
              )
            );
          }
        });
      });
    });
  }

  return issues;
}

module.exports = { run };
