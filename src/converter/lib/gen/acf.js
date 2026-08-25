'use strict';

const { phpArrayLiteral } = require('../php-util');
const { CPT_PREFIX } = require('../constants');

// 1フィールド(vocabulary.md 2章)を acf_add_local_field_group() の fields 配列要素へ変換する。
// ラベルは人手のリライトをしない(=推測しない)ため、フィールド名をそのままラベルにする。
// これは決定的変換を優先した本PoCの簡略化であり、report item5で明記する。
function fieldToAcf(groupSlug, field) {
  const def = {
    key: `field_${groupSlug}_${field.name}`,
    label: field.name,
    name: field.name,
    type: field.type,
  };
  if (field.type === 'image') {
    def.return_format = 'array'; // ichiki.md の型マッピングに準拠
  } else {
    def.default_value = field.defaultValue == null ? '' : field.defaultValue;
  }
  if (field.type === 'wysiwyg') {
    def.tabs = 'all';
    def.toolbar = 'full';
    def.media_upload = 0;
  }
  return def;
}

// data-section の切り替わりに ACF のタブを挟む。
//
// タブを入れないと編集画面が1列になる。実測: nkk_event は67フィールドが
// 仕切りなしで並んでいた。L1 が検収でこれを上から見るのは現実的でない。
//
// タブ名は data-section-label（日本語）。省略時は data-section の値をそのまま出す。
// **見出しテキストから推測しない。** 宣言の無い情報を勝手に読むと、
// 見出しの無いセクションで破綻し、しかも何が出るか書いた人に予測できない。
//
// tab は ACF 無料版に同梱されている（実測: 6.8.4 の includes/fields に class-acf-field-tab.php）。
function withSectionTabs(groupSlug, fields) {
  const out = [];
  let current = null;
  for (const f of fields) {
    const id = f.section && f.section.id;
    if (id && id !== current) {
      current = id;
      out.push({
        key: `field_${groupSlug}_tab_${id}`,
        label: (f.section && f.section.label) || id,
        name: '',
        type: 'tab',
        placement: 'top',
      });
    }
    out.push(fieldToAcf(groupSlug, f));
  }
  return out;
}

function buildFieldGroupPhp(groupSlug, title, fields, location, extra) {
  const group = Object.assign(
    {
      key: `group_${groupSlug}`,
      title,
      fields: withSectionTabs(groupSlug, fields),
      location,
      hide_on_screen: ['the_content'],
    },
    extra || {}
  );
  return `acf_add_local_field_group(\n    ${phpArrayLiteral(group, 1)}\n);\n`;
}

function phpFileHeader(label) {
  return [
    '<?php',
    '/**',
    ` * ${label}`,
    ' * acf-map（data-acf / data-acf-type）から生成した ACF フィールドグループ定義。',
    ' * このファイルは変換器(proposal/converter)が機械生成したもの。手編集しない。',
    ' */',
    '',
    "if ( ! defined( 'ABSPATH' ) ) { exit; }",
    '',
    "add_action( 'acf/init', function () {",
    '',
  ].join('\n');
}

function phpFileFooter() {
  return '\n} );\n';
}

function indentBlock(text) {
  return text
    .split('\n')
    .map((l) => (l ? '    ' + l : l))
    .join('\n');
}

// 固定ページ (data-page="page")
function generatePageAcf(pageId, fields, errors) {
  if (fields.length === 0) return null;
  const location = [[{ param: 'page_template', operator: '==', value: `page-${pageId}.php` }]];
  const body = buildFieldGroupPhp(pageId, `固定ページ: ${pageId}`, fields, location);
  return phpFileHeader(`inc/acf-${pageId}.php`) + indentBlock(body) + phpFileFooter();
}

// フロントページ
function generateFrontAcf(fields, errors) {
  if (fields.length === 0) return null;
  const location = [[{ param: 'page_type', operator: '==', value: 'front_page' }]];
  const body = buildFieldGroupPhp('front', 'フロントページ', fields, location);
  return phpFileHeader('inc/acf-front.php') + indentBlock(body) + phpFileFooter();
}

// CPT単体(single) — archive/フロントのループも同じフィールド名を参照する
function generateCptAcf(cpt, fields, hasArchive, errors) {
  const postType = `${CPT_PREFIX}${cpt}`;
  const location = [[{ param: 'post_type', operator: '==', value: postType }]];
  const body = buildFieldGroupPhp(cpt, `CPT: ${postType}`, fields, location);
  return phpFileHeader(`inc/acf-${cpt}.php`) + indentBlock(body) + phpFileFooter();
}

// CPT archive自身が持つ独自フィールド(このPoCの入力には存在しないが、汎用対応として実装)
function generateCptArchiveAcf(cpt, fields, errors) {
  if (fields.length === 0) return null;
  const location = [[{ param: 'page_template', operator: '==', value: `archive-${CPT_PREFIX}${cpt}.php` }]];
  const body = buildFieldGroupPhp(`${cpt}_archive`, `CPTアーカイブ独自: ${cpt}`, fields, location);
  return phpFileHeader(`inc/acf-${cpt}-archive.php`) + indentBlock(body) + phpFileFooter();
}

// data-common (site-options) — ACF無料版はオプションページを持たないため、
// 専用の非表示固定ページ(page-site-options.php)をロケーションに使う。
// vocabulary.md はサイト共通フィールドの保存先を規定していないため、これは変換器側の判断
// (ichiki.md CLAUDE.md が参照する「サイト設定ページ(site-options)」という概念名だけを踏襲した)。
function generateSiteOptionsAcf(fields, errors) {
  const location = [[{ param: 'page_template', operator: '==', value: 'page-site-options.php' }]];
  const body = buildFieldGroupPhp('site_options', 'サイト共通設定(site-options)', fields, location);
  return phpFileHeader('inc/acf-site-options.php') + indentBlock(body) + phpFileFooter();
}

module.exports = {
  generatePageAcf,
  generateFrontAcf,
  generateCptAcf,
  generateCptArchiveAcf,
  generateSiteOptionsAcf,
};
