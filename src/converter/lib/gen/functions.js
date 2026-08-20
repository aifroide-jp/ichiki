'use strict';

const { CPT_PREFIX } = require('../constants');
const { phpSingleQuote } = require('../php-util');

// 管理画面に表示するメニュー位置の名前。宣言名から機械的に作れないものだけ持つ。
const NAV_LABELS = {
  global: 'グローバルナビゲーション',
  mobile: 'モバイルナビゲーション',
  footer: 'フッターナビゲーション',
};
const { generateNavWalkers } = require('./nav-walker');

function generateFunctionsPhp(model, errors) {
  const lines = [];
  lines.push('<?php');
  lines.push('/**');
  lines.push(' * functions.php');
  lines.push(' * モックから変換器(proposal/converter)が機械生成したテーマ設定。');
  lines.push(' * 手編集しない。再生成すれば同じ入力から同じ出力になる(決定的変換)。');
  lines.push(' */');
  lines.push('');
  lines.push("if ( ! defined( 'ABSPATH' ) ) { exit; }");
  lines.push('');

  // --- テーマサポート・ナビメニュー登録 ---
  lines.push("function nkk_setup() {");
  lines.push("    add_theme_support( 'title-tag' );");
  lines.push("    add_theme_support( 'post-thumbnails' );");
  lines.push('    register_nav_menus( array(');
  for (const name of model.navMap.keys()) {
    // 第2引数は**管理画面に出る人間向けの名前**。宣言そのものを入れると
    // 「外観 → メニュー」の位置選択に data-nav="global" と表示され、
    // お客様がどれに割り当てるべきか判断できない。
    lines.push(`        ${phpSingleQuote(name)} => ${phpSingleQuote(NAV_LABELS[name] || `${name} ナビゲーション`)},`);
  }
  lines.push('    ) );');
  lines.push('}');
  lines.push("add_action( 'after_setup_theme', 'nkk_setup' );");
  lines.push('');

  // ナビは theme_location ごとに専用 Walker を生成する(下記 --- ナビ Walker --- )。
  // 以前は「形を2種類に分類して class 名だけ抜き出し、フィルタで差し戻す」方式だったが、
  // 形が増えるたびに分類と Walker が増える作りだった。テンプレート方式に置き換え済み。

  // --- CPT登録 ---
  lines.push('function nkk_register_post_types() {');
  for (const [cpt, entry] of model.cptMap) {
    const postType = `${CPT_PREFIX}${cpt}`;
    lines.push(`    register_post_type( ${phpSingleQuote(postType)}, array(`);
    lines.push(`        'label' => ${phpSingleQuote(cpt)},`);
    lines.push("        'labels' => array(");
    lines.push(`            'name' => ${phpSingleQuote(cpt)},`);
    lines.push(`            'singular_name' => ${phpSingleQuote(cpt)},`);
    lines.push('        ),');
    lines.push("        'public' => true,");
    // URL のスラッグは archive ページの場所から決まる。指定しないと投稿タイプ名
    // （nkk_event）がそのまま URL に出て、**モックで合意した URL と食い違う**。
    // 実測: モックは /events/ なのに /nkk_event/ になっていた。
    //   events/index.html   → events
    //   about/spots.html    → about/spots （index.html 以外は拡張子を落として使う）
    // archive が無い CPT は正解がモックに無いので指定しない（推測しない）。
    let archiveSlug = null;
    if (entry.archivePage) {
      archiveSlug = entry.archivePage.relPath.replace(/\.html$/, '').replace(/(^|\/)index$/, '');
      archiveSlug = archiveSlug.replace(/\/$/, '');
    }
    lines.push(`        'has_archive' => ${archiveSlug ? phpSingleQuote(archiveSlug) : 'false'},`);
    if (archiveSlug) {
      // with_front を false にしないと、パーマリンク設定の接頭辞が前に付いて
      // モックのパスと合わなくなる。
      lines.push(`        'rewrite' => array( 'slug' => ${phpSingleQuote(archiveSlug)}, 'with_front' => false ),`);
    }
    lines.push("        'show_in_rest' => true,");
    lines.push("        'supports' => array( 'title' ),");
    lines.push(`        'menu_icon' => 'dashicons-admin-post',`);
    lines.push('    ) );');
  }
  lines.push('}');
  lines.push("add_action( 'init', 'nkk_register_post_types' );");
  lines.push('');

  // --- data-page-variant: 同じ投稿の別テンプレート（vocabulary.md 1.1） ---
  //
  // add_rewrite_endpoint を使う。CPT の rewrite スラッグに依存せず
  // /<投稿のパーマリンク>/<variant>/ が有効になるため、
  // 「投稿を1つ作れば詳細ページと申込ページの両方ができる」を実現できる。
  // 固定ページを1枚ずつ手で作らせない（お客様の操作を増やさない）。
  const variants = [];
  for (const [cpt, entry] of model.cptMap) {
    for (const vname of (entry.variantPages || new Map()).keys()) {
      variants.push({ postType: `${CPT_PREFIX}${cpt}`, variant: vname });
    }
  }
  if (variants.length) {
    const names = [...new Set(variants.map((v) => v.variant))];
    lines.push('function nkk_register_variant_endpoints() {');
    for (const n of names) {
      // EP_ALL: CPT は独自の EP マスクを持たないため、限定すると効かない。
      lines.push(`    add_rewrite_endpoint( ${phpSingleQuote(n)}, EP_ALL );`);
    }
    lines.push('}');
    lines.push("add_action( 'init', 'nkk_register_variant_endpoints' );");
    lines.push('');
    // エンドポイントはリライト規則なので、追加しただけでは 404 になる。
    // テーマ切替時に1回だけ flush する（毎回 flush すると重い）。
    lines.push("add_action( 'after_switch_theme', function () {");
    lines.push('    nkk_register_post_types();');
    lines.push('    nkk_register_variant_endpoints();');
    lines.push('    flush_rewrite_rules();');
    lines.push('} );');
    lines.push('');
    lines.push('function nkk_variant_template( $template ) {');
    lines.push('    $map = array(');
    for (const v of variants) {
      lines.push(`        array( ${phpSingleQuote(v.postType)}, ${phpSingleQuote(v.variant)} ),`);
    }
    lines.push('    );');
    lines.push('    foreach ( $map as $m ) {');
    lines.push('        list( $post_type, $variant ) = $m;');
    lines.push('        if ( ! is_singular( $post_type ) ) { continue; }');
    lines.push("        // エンドポイントが URL に在るときだけ get_query_var が '' を返す。");
    lines.push('        // 既定を null にして「無い」と区別する。');
    lines.push('        if ( null === get_query_var( $variant, null ) ) { continue; }');
    lines.push('        $found = locate_template( array( "single-{$post_type}-{$variant}.php" ) );');
    lines.push('        if ( $found ) { return $found; }');
    lines.push('    }');
    lines.push('    return $template;');
    lines.push('}');
    lines.push("add_filter( 'template_include', 'nkk_variant_template' );");
    lines.push('');
  }

  // --- アセット(css)のenqueue。vocabulary.md 7章の css/base.css + css/page/*.css 構成に対応 ---
  lines.push('function nkk_enqueue_assets() {');
  lines.push("    $dir = get_template_directory_uri();");
  lines.push("    wp_enqueue_style( 'nkk-base', $dir . '/assets/css/base.css', array(), null );");
  lines.push('');
  lines.push('    if ( is_front_page() ) {');
  lines.push("        wp_enqueue_style( 'nkk-page-front', $dir . '/assets/css/page/front.css', array( 'nkk-base' ), null );");
  lines.push('    }');
  for (const pageId of model.pageMap.keys()) {
    lines.push(`    if ( is_page_template( 'page-${pageId}.php' ) ) {`);
    lines.push(
      `        wp_enqueue_style( 'nkk-page-${pageId}', $dir . '/assets/css/page/${pageId}.css', array( 'nkk-base' ), null );`
    );
    lines.push('    }');
  }
  for (const cpt of model.cptMap.keys()) {
    const postType = `${CPT_PREFIX}${cpt}`;
    lines.push(`    if ( is_singular( '${postType}' ) || is_post_type_archive( '${postType}' ) ) {`);
    lines.push(
      `        wp_enqueue_style( 'nkk-page-${cpt}', $dir . '/assets/css/page/${cpt}.css', array( 'nkk-base' ), null );`
    );
    lines.push('    }');
  }
  // --- アセット(js)のenqueue ---
  // サイト自身の JS。ハンバーガー・ドロップダウン・一覧の絞り込み等がここで動く
  // （絞り込みは data-type / data-category を読むので、宣言以外の data-* を
  //  残す処理と対で意味を持つ）。
  lines.push('');
  lines.push("    wp_enqueue_script( 'nkk-main', $dir . '/assets/js/main.js', array(), null, true );");

  // 外部の CSS（Leaflet 等）。ページごとに要否が違うので enqueue で出す。
  for (const [i, ext] of (model.externalCss || []).entries()) {
    lines.push(
      `    wp_enqueue_style( 'nkk-extcss-${i + 1}', ${phpSingleQuote(ext.href)}, array(), null );` +
        `   // ${ext.pages.map((p) => p.relPath).join(', ')}`
    );
  }

  // 外部ライブラリ（Leaflet 等）。モックが <script src="https://…"> で読んでいるもの。
  // ページ固有 JS がこれに依存するので、依存関係に入れて読み込み順を保証する。
  const extDeps = [];
  for (const [i, ext] of (model.externalScripts || []).entries()) {
    const handle = `nkk-ext-${i + 1}`;
    extDeps.push(handle);
    lines.push(
      `    wp_enqueue_script( '${handle}', ${phpSingleQuote(ext.src)}, array(), null, true );` +
        `   // ${ext.pages.map((p) => p.relPath).join(', ')}`
    );
  }
  const jsDeps = ['nkk-main', ...extDeps].map((h) => `'${h}'`).join(', ');
  // ページ固有 JS は css/page/*.css と同じ規約（js/page/<id>.js があれば読む）。
  if (model.pageJs) {
    if (model.pageJs.has('front')) {
      lines.push('');
      lines.push('    if ( is_front_page() ) {');
      lines.push(
        `        wp_enqueue_script( 'nkk-js-front', $dir . '/assets/js/page/front.js', array( ${jsDeps} ), null, true );`
      );
      lines.push('    }');
    }
    for (const pageId of model.pageMap.keys()) {
      if (!model.pageJs.has(pageId)) continue;
      lines.push(`    if ( is_page_template( 'page-${pageId}.php' ) ) {`);
      lines.push(
        `        wp_enqueue_script( 'nkk-js-${pageId}', $dir . '/assets/js/page/${pageId}.js', array( ${jsDeps} ), null, true );`
      );
      lines.push('    }');
    }
    for (const cpt of model.cptMap.keys()) {
      if (!model.pageJs.has(cpt)) continue;
      const postType = `${CPT_PREFIX}${cpt}`;
      lines.push(`    if ( is_singular( '${postType}' ) || is_post_type_archive( '${postType}' ) ) {`);
      lines.push(
        `        wp_enqueue_script( 'nkk-js-${cpt}', $dir . '/assets/js/page/${cpt}.js', array( ${jsDeps} ), null, true );`
      );
      lines.push('    }');
    }
  }
  lines.push('}');
  lines.push("add_action( 'wp_enqueue_scripts', 'nkk_enqueue_assets' );");
  lines.push('');

  // --- 固定リンク解決ヘルパー(vocabulary.md 2.2 / 10章) ---
  lines.push('/**');
  lines.push(' * data-page="page" のページのパーマリンクを、変換時に確定した data-page-id から取得する。');
  lines.push(' * ページはテーマ側では作成しない(inc/seed-posts.php 等、別工程の責務)ため、');
  lines.push(' * 該当スラッグのページが存在しない環境では空文字列を返す(実行時のnullガードであり、');
  lines.push(' * vocabulary.mdが禁じる「変換時のエスケープハッチ」とは異なる)。');
  lines.push(' */');
  // data-page-id → 固定ページのスラッグ。**変換規則の唯一の実装。**
  // 以前は functions.php と seed-menus.php に同じ str_replace が別々に書かれており、
  // 実測で片方（nkk_get_page_permalink）だけ変換を忘れていた。
  // その結果 wysiwyg 内のリンクが href="" になり、現在ページへ戻るリンクになっていた。
  lines.push('function nkk_page_slug( $page_id ) {');
  lines.push("    return str_replace( '_', '-', (string) $page_id );");
  lines.push('}');
  lines.push('');
  lines.push('function nkk_get_page_permalink( $page_id ) {');
  // data-page-id はアンダースコア区切り（about_biodiversity）だが、
  // 固定ページのスラッグはハイフン（about-biodiversity）。**変換を忘れると空文字が返る。**
  // 実測: wysiwyg 内のリンクが href="" になり、現在ページへ戻るリンクになっていた。
  // seed-posts / seed-menus 側は変換していたのに、ここだけ素通しだった。
  lines.push('    $page = get_page_by_path( nkk_page_slug( $page_id ) );');
  lines.push("    return $page ? get_permalink( $page ) : '';");
  lines.push('}');
  lines.push('');
  lines.push('/**');
  lines.push(' * 単一インスタンス想定のCPT(例: nkk_network)の、唯一の投稿へのパーマリンクを取得する。');
  lines.push(' * vocabulary.md はどの投稿を指すかの識別方法を定義していないため、');
  lines.push(' * 「該当CPTの最初の1件」を採用する(本PoCで変換器側が下した判断。report item5参照)。');
  lines.push(' */');
  lines.push('function nkk_get_single_permalink( $post_type ) {');
  lines.push("    $posts = get_posts( array( 'post_type' => $post_type, 'posts_per_page' => 1, 'orderby' => 'date', 'order' => 'ASC' ) );");
  lines.push("    return $posts ? get_permalink( $posts[0] ) : '';");
  lines.push('}');
  lines.push('');

  // --- サイトオプション取得ヘルパー ---
  lines.push('/**');
  lines.push(' * site-options 用の固定ページ(page-site-options.php を割り当てたページ)のIDを取得する。');
  lines.push(' * ACF無料版はオプションページを持たないための代替実装(ichiki.md準拠: ACF PRO専用機能に非依存)。');
  lines.push(' */');
  lines.push('/**');
  lines.push(' * CPT 一覧の独自フィールドを保持する固定ページのID。');
  lines.push(' * archive-<cpt>.php をテンプレートに設定したページ（inc/seed-posts.php が作る）。');
  lines.push(' * ACF 無料版にオプションページが無いための代替（ichiki.md 準拠）。');
  lines.push(' */');
  lines.push('function nkk_get_archive_settings_page_id( $scope ) {');
  lines.push('    static $cache = array();');
  lines.push('    if ( isset( $cache[ $scope ] ) ) { return $cache[ $scope ]; }');
  lines.push("    $cpt = preg_replace( '/_archive$/', '', $scope );");
  lines.push("    $page = get_page_by_path( $cpt . '-archive-settings' );");
  lines.push('    $cache[ $scope ] = $page ? $page->ID : 0;');
  lines.push('    return $cache[ $scope ];');
  lines.push('}');
  lines.push('');
  lines.push('function nkk_get_site_options_page_id() {');
  lines.push("    static $id = null;");
  lines.push('    if ( null === $id ) {');
  lines.push("        $page = get_page_by_path( 'site-options' );");
  lines.push('        $id = $page ? $page->ID : 0;');
  lines.push('    }');
  lines.push('    return $id;');
  lines.push('}');
  lines.push('');

  // --- ナビ Walker(theme_location ごとに1クラス) ---
  // 実装は lib/gen/nav-walker.js。生成PHPを単体テストできるよう切り出してある。
  for (const line of generateNavWalkers(model.navInfo)) lines.push(line);
  // 同じメニュー位置の2つ目以降の形にもウォーカーを作る（PC 用 / モバイル用など）
  for (const [name, variants] of model.navVariants || []) {
    if (!variants || variants.length < 2) continue;
    for (const v of variants.slice(1)) {
      const alias = new Map([[`${name}_${v.index + 1}`, v.info]]);
      for (const line of generateNavWalkers(alias)) lines.push(line);
    }
  }

  // --- inc/ の読み込み ---
  lines.push('foreach ( glob( get_template_directory() . \'/inc/*.php\' ) as $nkk_inc_file ) {');
  lines.push('    require_once $nkk_inc_file;');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

module.exports = { generateFunctionsPhp };
