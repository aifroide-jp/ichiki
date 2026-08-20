'use strict';

// 本語彙の構造宣言に使う data-* 属性の全一覧。
//
// **lint と変換器の両方がこれを読む。** 同じ一覧を2箇所に書くと必ずズレるため
// 共有モジュールに一本化する（src/shared/site-path.js と同じ方針）。
//
// なぜ必要か:
//   サイト自身の JS が使う data-* と、本語彙の構造宣言を区別するため。
//   実測で2箇所とも「data- で始まる全部」を対象にしており、どちらも誤りだった。
//
//   - 変換器: 出力から data-* を全部削除していた。イベント一覧のフィルタが
//     data-type / data-category / data-target で動いており（js/main.js が
//     dataset.category を読む）、変換後に黙って動かなくなっていた。
//   - lint(L13): data-* の値が全て ASCII であることを要求していた。フィルタの値は
//     日本語（data-filter-cat="生態系保全" 等）で、これは正当な内容であり
//     PHP 変数にも ACF キーにもならない。27件の誤検出になっていた。
//
// **語彙に宣言を追加したら、必ずここにも足すこと。**
const DECLARATION_ATTRS = new Set([
  'data-page',
  'data-page-id',
  'data-page-variant',
  'data-cpt',
  'data-section',
  'data-section-label',
  'data-acf',
  'data-acf-type',
  'data-acf-url',
  'data-loop',
  'data-loop-item',
  'data-loop-sample',
  'data-loop-order',
  'data-loop-count',
  'data-loop-repeat',
  'data-common',
  'data-nav',
  'data-nav-item',
  'data-nav-current',
  'data-breadcrumb',
  'data-deco',
  'data-cf7',
  'data-cf7-field',
  'data-cf7-required',
  'data-cf7-acceptance',
  'data-cf7-limit',
  'data-cf7-submit',
  'data-cf7-group',
  'data-cf7-group-if',
  'data-cf7-value',
]);

module.exports = { DECLARATION_ATTRS };
