'use strict';

// L10: data-cf7-submit がフォーム内にちょうど1個
// L24: 単独チェックボックスは data-cf7-acceptance の有無を明示する(warn)
//      ファイル欄には data-cf7-limit が必要(error)
const { mk } = require('../lib/issue');

function run(page) {
  const issues = [];
  const $ = page.$;

  // 単独のチェックボックスは「同意」か「選択肢」か、マークアップから決まらない。
  // 実測: 同じフォームに member_optin（選択肢・任意）と privacy（同意・必須）が並んでおり、
  // 必須かどうかでは区別できない。取り違えると
  //   選択肢→acceptance: チェックしないと送信できなくなる（テストで気づく）
  //   同意→checkbox    : 同意なしで送信できてしまう（**静かに通るので気づけない**）
  // 後者を防ぐため、宣言が無い単独チェックボックスは必ず一覧に出す。
  $('input[type="checkbox"][data-cf7-field]').each((_, el) => {
    const $el = $(el);
    if ($el.attr('data-cf7-acceptance') !== undefined) return;
    issues.push(
      mk(
        page,
        'L24',
        'warn',
        page.attrLineOf($el, 'data-cf7-field'),
        `data-cf7-field="${$el.attr('data-cf7-field')}" は単独のチェックボックスです` +
          '(同意なら data-cf7-acceptance を付けてください。付けないと「同意なしで送信できる」状態になります)'
      )
    );
  });

  // CF7 の既定上限は約1MB。モックの表記と食い違うと「アップロードできない」が静かに起きる。
  $('input[type="file"][data-cf7-field]').each((_, el) => {
    const $el = $(el);
    if ($el.attr('data-cf7-limit') === undefined) {
      issues.push(
        mk(
          page,
          'L24',
          'error',
          page.attrLineOf($el, 'data-cf7-field'),
          `data-cf7-field="${$el.attr('data-cf7-field')}" にはファイルサイズの上限（data-cf7-limit、バイト数）が必要です` +
            '(CF7 の既定は約1MB。書かないとモックの表記と食い違ったまま通ってしまいます)'
        )
      );
    }
  });

  $('[data-cf7]').each((_, el) => {
    const $el = $(el);
    const submits = $el.find('[data-cf7-submit]');
    const line = page.lineOf($el);
    if (submits.length !== 1) {
      issues.push(
        mk(
          page,
          'L10',
          'error',
          line,
          `data-cf7="${$el.attr('data-cf7')}" 内の data-cf7-submit が${submits.length}個です(ちょうど1個である必要があります)`
        )
      );
    }
  });

  // L29: 1フォームを複数投稿で使い回すための宣言（vocabulary.md 6.2節）
  //
  // 投稿ごとにフォームを作ると CF7 のフォームが投稿数に比例して増え、
  // 送信先・自動返信・メール本文を1件ずつ管理することになって運用が破綻する
  // （実測: イベント4件で申込フォームが4件生成されていた）。
  const VALID_CF7_VALUE = ['post_slug', 'post_title', 'post_id'];

  $('[data-cf7-group]').each((_, el) => {
    const $el = $(el);
    const line = page.attrLineOf($el, 'data-cf7-group');
    const name = $el.attr('data-cf7-group');

    if ($el.closest('[data-cf7]').length === 0) {
      issues.push(mk(page, 'L29', 'error', line, `data-cf7-group="${name}" が data-cf7 フォームの外にあります`));
    }
    const cond = $el.attr('data-cf7-group-if');
    if (cond === undefined) {
      issues.push(
        mk(page, 'L29', 'error', line, `data-cf7-group="${name}" に data-cf7-group-if がありません(どの投稿で出すかが決まりません)`)
      );
    } else if (!/^[a-z][a-z0-9_]*=.+$/.test(cond)) {
      issues.push(
        mk(page, 'L29', 'error', line, `data-cf7-group-if="${cond}" は <ACFフィールド名>=<値> の形で書いてください`)
      );
    }
  });

  $('[data-cf7-value]').each((_, el) => {
    const $el = $(el);
    const line = page.attrLineOf($el, 'data-cf7-value');
    const v = $el.attr('data-cf7-value');
    if ($el.closest('[data-cf7]').length === 0) {
      issues.push(mk(page, 'L29', 'error', line, `data-cf7-value="${v}" が data-cf7 フォームの外にあります`));
    }
    if (!VALID_CF7_VALUE.includes(v)) {
      issues.push(
        mk(page, 'L29', 'error', line, `data-cf7-value="${v}" は無効です(有効値: ${VALID_CF7_VALUE.join(' / ')})`)
      );
    }
  });

  return issues;
}

module.exports = { run };
