'use strict';

// inc/seed-posts.php を生成する。
//
// **構造化したモックを正とする理由は、そのまま WordPress にデータごと流し込むため。**
// テンプレートと ACF 定義だけ作っても、中身が空なら意味が無い。
// モックに書いてある値がそのまま初期データになる。
//
// これが無かったとき何が起きていたか（実測）:
//   - 全ページが ACF のデフォルト値表示になり、投稿ごとの差が出なかった
//   - 一覧のカードが「中身が1種類しかない」状態で並んでいた
//   - 動いているのは旧テーマが投入したデータで、新テーマはそれを読めていなかった
//
// 投入するもの（CLAUDE.md「seed-posts.php の責務」に対応）:
//   1. 固定ページ（テンプレート指定込み）
//   2. CPT の初期記事（モックの single ページ1枚分）
//   3. サイト共通設定（site-options）
//   4. フロントページ設定
// CF7 フォームは inc/seed-cf7.php、メニューは inc/seed-menus.php が担当する。

const { phpSingleQuote } = require('../php-util');
const { CPT_PREFIX } = require('../constants');

// image 型は URL 文字列では入らない（ACF は添付ファイル ID を持つ）。
// sideload まで踏み込むと別の判断が要るので、ここでは飛ばして
// テンプレート側のフォールバック（assets/ のモック画像）に任せる。
function seedableFields(fields) {
  return (fields || []).filter((f) => f.type !== 'image' && f.defaultValue !== null && f.defaultValue !== undefined);
}

function fieldAssignments(scopeSlug, fields, indent) {
  const L = [];
  for (const f of seedableFields(fields)) {
    const key = `field_${scopeSlug}_${f.name}`;
    // defaultValue は PHP の式（wysiwyg のリンク解決で連結式になることがある）か素の文字列。
    const value =
      typeof f.defaultValue === 'object' && f.defaultValue && f.defaultValue.__php
        ? f.defaultValue.__php
        : phpSingleQuote(String(f.defaultValue));
    L.push(`${indent}update_field( '${key}', ${value}, $post_id );`);
  }
  return L;
}

function generateSeedPostsPhp(model) {
  const L = [];
  L.push('<?php');
  L.push('/**');
  L.push(' * inc/seed-posts.php');
  L.push(' * モックの値をそのまま初期データとして投入する。');
  L.push(' * 既に存在するものは作り直さない（お客様の編集を上書きしない）。');
  L.push(' */');
  L.push('');
  L.push("if ( ! defined( 'ABSPATH' ) ) { exit; }");
  L.push('');
  L.push('// 同じスラッグの投稿があればその ID、無ければ作って ID を返す。');
  L.push('function nkk_seed_get_or_create( $post_type, $slug, $title, $template = null ) {');
  L.push('    $existing = get_posts( array(');
  L.push("        'post_type'   => $post_type,");
  L.push("        'name'        => $slug,");
  L.push("        'post_status' => 'any',");
  L.push("        'numberposts' => 1,");
  L.push('    ) );');
  L.push('    if ( $existing ) { return array( $existing[0]->ID, false ); }');
  L.push('    $post_id = wp_insert_post( array(');
  L.push("        'post_type'   => $post_type,");
  L.push("        'post_name'   => $slug,");
  L.push("        'post_title'  => $title,");
  L.push("        'post_status' => 'publish',");
  L.push('    ) );');
  L.push('    if ( is_wp_error( $post_id ) ) { return array( 0, false ); }');
  L.push('    if ( $template ) { update_post_meta( $post_id, \'_wp_page_template\', $template ); }');
  L.push('    return array( $post_id, true );');
  L.push('}');
  L.push('');
  L.push('function nkk_seed_posts() {');
  L.push("    if ( ! function_exists( 'update_field' ) ) { return; }");
  L.push("    if ( get_option( 'nkk_seeded_posts' ) ) { return; }");
  L.push('');

  // --- 1. 固定ページ ---
  for (const [pageId, entry] of model.pageMap) {
    const slug = pageId.replace(/_/g, '-');
    const title = (entry.page && entry.page.title) || pageId;
    L.push(`    // 固定ページ: ${pageId}`);
    L.push(
      `    list( $post_id, $created ) = nkk_seed_get_or_create( 'page', ${phpSingleQuote(slug)}, ${phpSingleQuote(title)}, ${phpSingleQuote(`page-${pageId}.php`)} );`
    );
    L.push('    if ( $post_id && $created ) {');
    L.push(...fieldAssignments(pageId, entry.fields, '        '));
    L.push('    }');
    L.push('');
  }

  // --- 2. CPT の初期記事（モックの single 1枚ぶん） ---
  for (const [cpt, entry] of model.cptMap) {
    if (!entry.canonicalSingle || !entry.fields || entry.fields.length === 0) continue;
    const postType = `${CPT_PREFIX}${cpt}`;
    const rel = entry.canonicalSingle.relPath || '';
    const slug = rel.replace(/\.html$/, '').split('/').pop() || cpt;
    const title = entry.canonicalSingle.title || cpt;
    L.push(`    // CPT 初期記事: ${postType}（モック ${rel} の内容）`);
    L.push(
      `    list( $post_id, $created ) = nkk_seed_get_or_create( ${phpSingleQuote(postType)}, ${phpSingleQuote(slug)}, ${phpSingleQuote(title)} );`
    );
    L.push('    if ( $post_id && $created ) {');
    L.push(...fieldAssignments(cpt, entry.fields, '        '));
    L.push('    }');
    L.push('');
  }

  // --- 3. サイト共通設定 ---
  if (model.siteOptionFields && model.siteOptionFields.length) {
    L.push('    // サイト共通設定（site-options ページ）');
    L.push("    list( $post_id, $created ) = nkk_seed_get_or_create( 'page', 'site-options', 'サイト共通設定', 'page-site-options.php' );");
    L.push('    if ( $post_id && $created ) {');
    L.push(...fieldAssignments('site_options', model.siteOptionFields, '        '));
    L.push('    }');
    L.push('');
  }

  L.push("    update_option( 'nkk_seeded_posts', 1 );");
  L.push('}');
  L.push("add_action( 'admin_init', 'nkk_seed_posts' );");
  L.push('');
  return L.join('\n');
}

module.exports = { generateSeedPostsPhp };
