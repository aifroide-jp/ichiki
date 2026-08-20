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

// image 型は URL 文字列では入らない（ACF は添付ファイル ID を持つ）ので、
// テーマの assets/ にある画像をメディアライブラリへ登録してから ID を入れる。
//
// 登録しないとどうなるか（実測）:
//   画面には出る（テンプレのフォールバックが assets/ を直接指すため）が、
//   **メディアライブラリが空**で ACF の画像欄も空。
//   お客様が管理画面から差し替えようとしても、選ぶ元が存在しない。
//   検収で「画像を差し替えてみてください」ができない状態だった。
function seedableFields(fields) {
  return (fields || []).filter((f) => f.type !== 'image' && f.defaultValue !== null && f.defaultValue !== undefined);
}

function imageFields(fields) {
  return (fields || []).filter((f) => f.type === 'image' && f.asset);
}

function imageAssignments(scopeSlug, fields, indent) {
  const L = [];
  for (const f of imageFields(fields)) {
    const key = `field_${scopeSlug}_${f.name}`;
    L.push(
      `${indent}nkk_seed_set_image( $post_id, '${key}', ${phpSingleQuote(f.asset)}, ${phpSingleQuote(f.alt || '')} );`
    );
  }
  return L;
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
  L.push(...imageAssignments(scopeSlug, fields, indent));
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
  // テーマの assets/ にある画像をメディアライブラリへ登録し、ACF の画像欄に入れる。
  //
  // 同じファイルを二度登録しない。判定はファイル名ではなく **_nkk_asset**（assets からの
  // 相対パス）で行う。ファイル名だけだと別ディレクトリの同名画像を取り違える
  // （実測: 2025/03 と 2026/04 に同名の jpg がある）。
  L.push('function nkk_seed_attach_asset( $rel, $alt = \'\' ) {');
  L.push("    $found = get_posts( array(");
  L.push("        'post_type'   => 'attachment',");
  L.push("        'post_status' => 'inherit',");
  L.push("        'numberposts' => 1,");
  L.push("        'meta_key'    => '_nkk_asset',");
  L.push("        'meta_value'  => $rel,");
  L.push('    ) );');
  L.push('    if ( $found ) { return (int) $found[0]->ID; }');
  L.push('');
  L.push("    $src = trailingslashit( get_template_directory() ) . 'assets/' . $rel;");
  L.push('    if ( ! file_exists( $src ) ) { return 0; }');
  L.push('');
  L.push("    require_once ABSPATH . 'wp-admin/includes/file.php';");
  L.push("    require_once ABSPATH . 'wp-admin/includes/media.php';");
  L.push("    require_once ABSPATH . 'wp-admin/includes/image.php';");
  L.push('');
  // アップロード先へコピーしてから登録する。テーマ内のファイルを直接指すと、
  // テーマを消したときにメディアが壊れる。
  L.push('    $up = wp_upload_dir();');
  L.push("    $dst_rel = 'nkk/' . $rel;");
  L.push("    $dst = trailingslashit( $up['basedir'] ) . $dst_rel;");
  L.push('    wp_mkdir_p( dirname( $dst ) );');
  L.push('    if ( ! copy( $src, $dst ) ) { return 0; }');
  L.push('');
  L.push('    $type = wp_check_filetype( $dst );');
  L.push('    $id = wp_insert_attachment( array(');
  L.push("        'post_mime_type' => $type['type'],");
  L.push("        'post_title'     => sanitize_file_name( basename( $rel ) ),");
  L.push("        'post_status'    => 'inherit',");
  L.push('    ), $dst );');
  L.push('    if ( is_wp_error( $id ) || ! $id ) { return 0; }');
  L.push('');
  L.push('    wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $dst ) );');
  L.push("    update_post_meta( $id, '_nkk_asset', $rel );");
  L.push("    if ( $alt !== '' ) { update_post_meta( $id, '_wp_attachment_image_alt', $alt ); }");
  L.push('    return (int) $id;');
  L.push('}');
  L.push('');
  L.push('function nkk_seed_set_image( $post_id, $field_key, $rel, $alt ) {');
  // 既に値が入っていれば触らない。お客様が差し替えたものを上書きしないため。
  L.push('    if ( get_field( $field_key, $post_id ) ) { return; }');
  L.push('    $id = nkk_seed_attach_asset( $rel, $alt );');
  L.push('    if ( $id ) { update_field( $field_key, $id, $post_id ); }');
  L.push('}');
  L.push('');
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
  L.push("        'post_title'  => nkk_page_title( $title ),");
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

  // --- 2.5 トップページ ---
  //
  // front のフィールドは「フロントページに設定された固定ページ」に紐づく
  // （group_front の location が page_type == front_page）。
  // その受け皿を作って show_on_front を設定しないと、**値を保存する先が存在しない**。
  // 実測: front-page.php はテンプレート階層で優先されるので画面は出るが、
  // 画像9枚を含む70フィールドがどこにも入らず、管理画面から編集もできなかった。
  if (model.front && model.front.ownFields && model.front.ownFields.length) {
    L.push('    // トップページ（front のフィールドの受け皿）');
    L.push(
      `    list( $post_id, $created ) = nkk_seed_get_or_create( 'page', 'front', ${phpSingleQuote(model.front.title || 'トップページ')} );`
    );
    L.push('    if ( $post_id ) {');
    L.push("        update_option( 'show_on_front', 'page' );");
    L.push("        update_option( 'page_on_front', $post_id );");
    L.push('    }');
    L.push('    if ( $post_id && $created ) {');
    L.push(...fieldAssignments('front', model.front.ownFields, '        '));
    L.push('    }');
    L.push('');
  }

  // --- 2.6 CPT 一覧ページ独自のフィールド ---
  //
  // archive のフィールドは **archive-<cpt>.php をテンプレートに設定した固定ページ**に紐づく
  // （acf.js の location が page_template == archive-nkk_xxx.php）。
  // ACF 無料版にオプションページは無いので 'option' には保存できない。
  // 受け皿の固定ページが無いと、値の置き場所が存在しない。
  for (const [cpt, entry] of model.cptMap) {
    const af = entry.archiveFields || [];
    if (!af.length) continue;
    const tmpl = `archive-${CPT_PREFIX}${cpt}.php`;
    const slug = `${cpt}-archive-settings`;
    L.push(`    // CPT 一覧の独自フィールドの受け皿: ${cpt}`);
    L.push(
      `    list( $post_id, $created ) = nkk_seed_get_or_create( 'page', ${phpSingleQuote(slug)}, ${phpSingleQuote(`${cpt} 一覧の設定`)}, ${phpSingleQuote(tmpl)} );`
    );
    L.push('    if ( $post_id && $created ) {');
    L.push(...fieldAssignments(`${cpt}_archive`, af, '        '));
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
