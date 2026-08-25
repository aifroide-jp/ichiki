'use strict';

// inc/seed-menus.php を生成する。
//
// モックの <nav data-nav="..."> には**実際のメニュー項目**が書いてある。
// それを WordPress のメニューとして自動投入し、テーマの表示位置に割り当てる。
//
// なぜやるか:
//   テーマは表示位置（global / mobile / footer）を登録するだけなので、
//   お客様が「外観 → メニュー」でメニューを作り、項目を1つずつ足し、
//   位置に割り当てる必要があった。**モックに全部書いてあるのに、である。**
//   実測: global 25項目・mobile 26項目・footer 28項目を手作業させることになっていた。
//   CF7 のフォームを inc/seed-cf7.php で投入しているのと同じ扱いにする。
//
// 行き先は**参照**で持つ。カスタムリンクにはしない。
//
// カスタムリンクは URL を焼き付けるため、
//   - 管理画面に「カスタムリンク」として並び、どのページを指すか分からない
//   - 固定ページのスラッグを変えるとメニューだけ壊れる
//   - 投稿を削除してもリンクが残り 404 になる
// 固定ページは post_type、CPT 一覧は post_type_archive で持たせる。
// 外部URL・# アンカー・mailto: だけがカスタムリンクになる。

const { phpSingleQuote } = require('../php-util');
const { CPT_PREFIX } = require('../constants');
const { classifyHref } = require('../link-resolve');

// メニュー名は管理画面にそのまま出る。nkk-global のような内部識別子を付けると
// お客様には意味が分からない（表示位置のラベルで同じ誤りをして直したのに、
// メニュー名で繰り返していた）。表示位置のラベルと同じ日本語を使う。
const MENU_NAMES = {
  global: 'グローバルナビゲーション',
  mobile: 'モバイルナビゲーション',
  footer: 'フッターナビゲーション',
};

function generateSeedMenusPhp(model) {
  const navs = [...(model.navInfo || [])].filter(([, info]) => info && info.menuItems && info.menuItems.length);

  // 相対パスの基準は「その nav が書かれているページ」。
  // 固定値 'index.html' を基準にしていたため ../about/ が /../about/ に解決され、
  // 全項目が参照にできずカスタムリンクに落ちていた（実測 49/53 件）。
  const navBaseRel = (location) => {
    const entry = model.navMap && model.navMap.get(location);
    return (entry && entry.page && entry.page.relPath) || 'index.html';
  };
  if (navs.length === 0) return null;

  const L = [];
  L.push('<?php');
  L.push('/**');
  L.push(' * inc/seed-menus.php');
  L.push(' * モックの <nav data-nav="..."> からメニューを作り、表示位置に割り当てる。');
  L.push(' * 既にメニューが割り当てられている位置には手を出さない。');
  L.push(' * 本番はテーマを差し替えるだけなので、旧サイトのメニューが DB に残る。');
  L.push(' * 勝手に置き換えるとお客様の編集が消えるため、既定では触らない。');
  L.push(' *');
  L.push(' *');
  L.push(' * **投入は1回だけ。** admin_init は管理画面の全リクエストで発火するため、');
  L.push(' * ここで毎回作り直すとメニューが破棄・再生成され続け、term_id が増え続ける。');
  L.push(' * 編集中に開いていたメニューが消えて別のメニューへ飛ばされる（実測）。');
  L.push(' * 作り直したいときは option nkk_seeded_menus を消す。');
  L.push(' */');
  L.push('');
  L.push("if ( ! defined( 'ABSPATH' ) ) { exit; }");
  L.push('');
  L.push('function nkk_seed_nav_menus() {');
  L.push('    $defs = array(');

  for (const [location, info] of navs) {
    L.push(`        ${phpSingleQuote(location)} => array(`);
    for (const it of info.menuItems) {
      // モック内リンクは「サイトパス」で持たせ、投入時にパーマリンクへ解決する。
      // 解決できないもの・外部リンクはカスタムリンクにする。
      const cls = classifyHref(it.href || '', navBaseRel(location));
      let target = `array( 'url' => ${phpSingleQuote(it.href || '#')} )`;
      if (cls.kind === 'internal') {
        const d = model.linkRegistry && model.linkRegistry.get(cls.sitePath);
        if (d && d.kind === 'page') {
          target = `array( 'page_id' => ${phpSingleQuote(d.pageId)} )`;
        } else if (d && d.kind === 'archive') {
          target = `array( 'cpt_archive' => ${phpSingleQuote(`${CPT_PREFIX}${d.cpt}`)} )`;
        } else if (d && d.kind === 'front') {
          target = `array( 'front' => true )`;
        } else {
          // レジストリに無い行き先。2種類ある。
          //
          //  a) CPT の個別投稿（/center/yamada/ 等）
          //     レジストリは「その CPT の single テンプレート」しか持たないため
          //     投稿1件を特定できない。スラッグで投稿を引けば参照にできる。
          //  b) まだ書いていないページ
          //     参照にできないので URL で持つしかない。
          const clean = String(cls.sitePath || '').replace(/\.html$/, '').replace(/\/+$/, '');
          const seg = clean.split('/');
          const parentPath = seg.slice(0, -1).join('/');
          const slug = seg[seg.length - 1] || '';
          const parent = model.linkRegistry && model.linkRegistry.get(`${parentPath}/`);
          if (parent && parent.kind === 'archive' && slug) {
            // a) その CPT の投稿をスラッグで引く
            target =
              `array( 'cpt_post' => ${phpSingleQuote(`${CPT_PREFIX}${parent.cpt}`)}, ` +
              `'slug' => ${phpSingleQuote(slug)} )`;
          } else {
            target = `array( 'url' => ${phpSingleQuote('/' + clean + '/')}, 'unresolved' => true )`;
          }
        }
      }
      L.push(
        `            array( 'label' => ${phpSingleQuote(it.label)}, 'parent' => ${it.parent}, 'target' => ${target} ),`
      );
    }
    L.push('        ),');
  }
  L.push('    );');
  L.push('');
  L.push('    // 一度投入したら二度と走らない。admin_init は毎リクエスト発火するため。');
  L.push("    if ( get_option( 'nkk_seeded_menus' ) ) { return; }");
  L.push('');
  L.push('    foreach ( $defs as $location => $items ) {');
  L.push('        $name = nkk_menu_name_for( $location );');
  L.push('        $assigned = get_theme_mod( \'nav_menu_locations\', array() );');
  L.push('');
  L.push('        // 既に割り当て済みなら触らない（本番はテーマ差し替えだけなので旧メニューが残る。');
  L.push('        // 勝手に置き換えるとお客様の編集が消える）。');
  L.push('        if ( ! empty( $assigned[ $location ] ) && wp_get_nav_menu_object( $assigned[ $location ] ) ) {');
  L.push('            continue;');
  L.push('        }');
  L.push('');
  L.push('        $menu = wp_get_nav_menu_object( $name );');
  L.push('        if ( ! $menu ) {');
  L.push('            // 名前は日本語（管理画面の表示用）、スラッグは ASCII（識別子）。');
  L.push('            // 日本語のままだとスラッグが URL エンコードされ、管理画面の');
  L.push('            // メニュー切り替えに長大な %xx 列が乗る。');
  L.push('            $menu_id = wp_create_nav_menu( $name );');
  L.push('            if ( is_wp_error( $menu_id ) ) { continue; }');
  L.push("            wp_update_term( $menu_id, 'nav_menu', array( 'slug' => 'nkk-' . $location ) );");
  L.push('        } else {');
  L.push('            $menu_id = $menu->term_id;');
  L.push('        }');
  L.push('');
  L.push('        // 既に項目があるなら作り直さない');
  L.push('        if ( wp_get_nav_menu_items( $menu_id ) ) {');
  L.push('            $assigned[ $location ] = $menu_id;');
  L.push('            set_theme_mod( \'nav_menu_locations\', $assigned );');
  L.push('            continue;');
  L.push('        }');
  L.push('');
  L.push('        $ids = array();');
  L.push('        foreach ( $items as $i => $item ) {');
  L.push('            $args = array(');
  L.push('                \'menu-item-title\'  => $item[\'label\'],');
  L.push('                \'menu-item-status\' => \'publish\',');
  L.push('            );');
  L.push('            $t = $item[\'target\'];');
  L.push('            if ( isset( $t[\'page_id\'] ) ) {');
  L.push('                // 固定ページは参照で持つ（スラッグ変更に追随し、管理画面にページ名が出る）');
  L.push('                $page = nkk_seed_page_by_id( $t[\'page_id\'] );');
  L.push('                if ( $page ) {');
  L.push('                    $args[\'menu-item-type\']      = \'post_type\';');
  L.push('                    $args[\'menu-item-object\']    = \'page\';');
  L.push('                    $args[\'menu-item-object-id\'] = $page->ID;');
  L.push('                } else { nkk_menu_drop( $item[\'label\'], "固定ページ " . $t[\'page_id\'] . " が見つかりません" ); continue; }');
  L.push('            } elseif ( isset( $t[\'cpt_post\'] ) ) {');
  L.push('                // CPT の個別投稿。スラッグで引いて参照で持つ。');
  L.push('                $found = get_posts( array(');
  L.push('                    \'post_type\'   => $t[\'cpt_post\'],');
  L.push('                    \'name\'        => $t[\'slug\'],');
  L.push('                    \'post_status\' => \'publish\',');
  L.push('                    \'numberposts\' => 1,');
  L.push('                ) );');
  L.push('                if ( $found ) {');
  L.push('                    $args[\'menu-item-type\']      = \'post_type\';');
  L.push('                    $args[\'menu-item-object\']    = $t[\'cpt_post\'];');
  L.push('                    $args[\'menu-item-object-id\'] = $found[0]->ID;');
  L.push('                } else { nkk_menu_drop( $item[\'label\'], "投稿 " . $t[\'cpt_post\'] . "/" . $t[\'slug\'] . " が見つかりません" ); continue; }');
  L.push('            } elseif ( isset( $t[\'cpt_archive\'] ) ) {');
  L.push('                $args[\'menu-item-type\']   = \'post_type_archive\';');
  L.push('                $args[\'menu-item-object\'] = $t[\'cpt_archive\'];');
  L.push('            } elseif ( isset( $t[\'front\'] ) ) {');
  L.push('                $args[\'menu-item-type\'] = \'custom\';');
  L.push('                $args[\'menu-item-url\']  = home_url( \'/\' );');
  L.push('            } else {');
  L.push('                $args[\'menu-item-type\'] = \'custom\';');
  L.push('                $args[\'menu-item-url\']  = $t[\'url\'];');
  L.push('            }');
  L.push('            if ( $item[\'parent\'] >= 0 && isset( $ids[ $item[\'parent\'] ] ) ) {');
  L.push('                $args[\'menu-item-parent-id\'] = $ids[ $item[\'parent\'] ];');
  L.push('            }');
  L.push('            $ids[ $i ] = wp_update_nav_menu_item( $menu_id, 0, $args );');
  L.push('        }');
  L.push('');
  L.push('        $assigned[ $location ] = $menu_id;');
  L.push('        set_theme_mod( \'nav_menu_locations\', $assigned );');
  L.push('    }');
  L.push('');
  L.push("    update_option( 'nkk_seeded_menus', 1 );");
  L.push('}');
  L.push('// 優先度 20。inc/*.php は glob のアルファベット順で読まれるため、既定の優先度だと');
  L.push('// seed-menus が seed-posts より先に走る。固定ページがまだ無い状態でメニューを組むと、');
  L.push('// page_id で引く項目が解決できず**黙って落ちる**');
  L.push('// （実測: お問合せが消え、しかも一度きりガードが立つので二度と入らなかった）。');
  L.push("add_action( 'admin_init', 'nkk_seed_nav_menus', 20 );");
  L.push('');
  // メニュー名。管理画面にそのまま出るので、内部識別子ではなく日本語にする。
  // data-page-id から固定ページを引く。seed-posts.php が同じ規則でスラッグを作る
  // （page_id のアンダースコアをハイフンに置換）。
  L.push('/**');
  L.push(' * メニュー項目を作れなかったときの記録。');
  L.push(' * 黙って落とすと、ナビが短くなっていることに誰も気づけない');
  L.push(' * （実測: 25本のはずが15本になっていた）。');
  L.push(' */');
  L.push('function nkk_menu_drop( $label, $reason ) {');
  L.push('    $log = (array) get_option( \'nkk_menu_dropped\', array() );');
  L.push('    $log[] = $label . \': \' . $reason;');
  L.push('    update_option( \'nkk_menu_dropped\', $log );');
  L.push('}');
  L.push('');
  L.push('function nkk_seed_page_by_id( $page_id ) {');
  // 変換規則は functions.php の nkk_page_slug が唯一の実装。ここでは呼ぶだけ。
  L.push('    $page = get_page_by_path( nkk_page_slug( $page_id ) );');
  L.push('    return $page ? $page : null;');
  L.push('}');
  L.push('');
  L.push('function nkk_menu_name_for( $location ) {');
  L.push('    $names = array(');
  for (const [location] of navs) {
    L.push(`        ${phpSingleQuote(location)} => ${phpSingleQuote(MENU_NAMES[location] || `${location} ナビゲーション`)},`);
  }
  L.push('    );');
  L.push('    return isset( $names[ $location ] ) ? $names[ $location ] : $location;');
  L.push('}');
  L.push('');
  return L.join('\n');
}

module.exports = { generateSeedMenusPhp };
