'use strict';

// vocabulary.md が定める定数の**唯一の定義場所**。
// lint と変換器は必ずここを参照する（`lint/lib/constants.js` と
// `converter/lib/constants.js` は再エクスポートするだけ）。
//
// なぜ共有するか: 以前これらを2箇所に書いていて、語彙を変えたときに
// 片方だけ直して乖離した（相対パス化のとき lint 側だけ正規化を入れ、
// 変換器が18件のエラーで停止した）。同じ事故を構造的に起こさないため。

// --- 型導出テーブル（vocabulary.md 2.1 + 2.2 の <a>）-------------------
// これが正。DERIVABLE_TAGS はここから導出するので、
// 「表に足したのに一覧に足し忘れる」というズレが起きない。
const TAG_TO_TYPE = {
  h1: 'text', h2: 'text', h3: 'text', h4: 'text', h5: 'text', h6: 'text',
  p: 'textarea', li: 'textarea', dd: 'textarea', td: 'textarea', span: 'textarea',
  img: 'image',
  a: 'text', // リンクテキスト。href は data-acf-url（2.2節）
};

// data-acf が付いていても data-acf-type を必須としないタグ
const DERIVABLE_TAGS = Object.keys(TAG_TO_TYPE);

// --- 値の集合 ----------------------------------------------------------
const VALID_ACF_TYPES = ['text', 'textarea', 'wysiwyg', 'url', 'image'];

const VALID_DATA_PAGE = ['front', 'page', 'archive', 'single'];

// data-acf 命名規則: ASCII小文字・数字・アンダースコアのみ、数字始まり禁止
// （PHP変数名・ACFキーになるため。vocabulary.md 2.3）
const ACF_NAME_RE = /^[a-z][a-z0-9_]*$/;

module.exports = {
  TAG_TO_TYPE,
  DERIVABLE_TAGS,
  VALID_ACF_TYPES,
  VALID_DATA_PAGE,
  ACF_NAME_RE,
};
