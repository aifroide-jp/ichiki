'use strict';

// inc/cf7-dynamic.php を生成する（vocabulary.md 6.2）。
//
// 1つの CF7 フォームを複数の投稿で使い回すための仕掛け。表示中の投稿を見て
//   - 条件に合わない data-cf7-group のブロックを HTML から削除する
//   - data-cf7-value を持つ hidden に投稿の値（スラッグ／タイトル／ID）を差し込む
// を wpcf7_form_elements フィルタで行う。
//
// なぜサーバ側でやるか:
//   - JS の条件表示だと、切られたときに無関係な欄が出る
//   - CF7 は必須欄をサーバ側で検証するので、隠しただけの必須欄があると送信できなくなる
//   欄ごと消せば両方起きない。CF7 の条件分岐プラグインも要らない。
//
// フォーム本文には cf7.js が <!--nkk-group:名前--> … <!--/nkk-group:名前--> の目印を
// 埋め込んである。CF7 のレンダリング結果にコメントはそのまま残るので範囲を特定できる。

const { phpSingleQuote } = require('../php-util');

function generateCf7DynamicPhp(model) {
  const dyn = model.cf7Dynamic;
  if (!dyn || dyn.size === 0) return null;

  const L = [];
  L.push('<?php');
  L.push('/**');
  L.push(' * inc/cf7-dynamic.php');
  L.push(' * data-cf7-group / data-cf7-value から生成（vocabulary.md 6.2）。');
  L.push(' * 1つのフォームを複数の投稿で使い回すため、表示中の投稿に応じて');
  L.push(' * フォームの HTML を絞り込む。');
  L.push(' */');
  L.push('');
  L.push("if ( ! defined( 'ABSPATH' ) ) { exit; }");
  L.push('');

  // 条件表: フォーム名 => グループ名 => [ACFフィールド, 一致する値]
  L.push('function nkk_cf7_group_conditions() {');
  L.push('    return array(');
  for (const [form, info] of dyn) {
    if (!info.groups.size) continue;
    L.push(`        ${phpSingleQuote(form)} => array(`);
    for (const [g, c] of info.groups) {
      L.push(`            ${phpSingleQuote(g)} => array( ${phpSingleQuote(c.field)}, ${phpSingleQuote(c.value)} ),`);
    }
    L.push('        ),');
  }
  L.push('    );');
  L.push('}');
  L.push('');

  // hidden に入れる値の出どころ表: フォーム名 => CF7フィールド名 => 種別
  L.push('function nkk_cf7_dynamic_values() {');
  L.push('    return array(');
  for (const [form, info] of dyn) {
    if (!info.dynamicValues.size) continue;
    L.push(`        ${phpSingleQuote(form)} => array(`);
    for (const [f, kind] of info.dynamicValues) {
      L.push(`            ${phpSingleQuote(f)} => ${phpSingleQuote(kind)},`);
    }
    L.push('        ),');
  }
  L.push('    );');
  L.push('}');
  L.push('');

  L.push('add_filter( \'wpcf7_form_elements\', function( $html ) {');
  L.push('    $form = function_exists( \'wpcf7_get_current_contact_form\' ) ? wpcf7_get_current_contact_form() : null;');
  L.push('    if ( ! $form ) { return $html; }');
  L.push('    $title = $form->title();');
  L.push('    $post  = get_post();');
  L.push('');
  L.push('    // --- グループの出し分け ---');
  L.push('    $conds = nkk_cf7_group_conditions();');
  L.push('    if ( isset( $conds[ $title ] ) ) {');
  L.push('        foreach ( $conds[ $title ] as $group => $cond ) {');
  L.push('            list( $field, $want ) = $cond;');
  L.push('            $actual = ( $post && function_exists( \'get_field\' ) ) ? get_field( $field, $post->ID ) : null;');
  L.push('            $keep   = ( null !== $actual && (string) $actual === (string) $want );');
  L.push('            $open   = \'<!--nkk-group:\' . $group . \'-->\';');
  L.push('            $close  = \'<!--/nkk-group:\' . $group . \'-->\';');
  L.push('            $pattern = \'/\' . preg_quote( $open, \'/\' ) . \'.*?\' . preg_quote( $close, \'/\' ) . \'/s\';');
  L.push('            if ( $keep ) {');
  L.push('                // 残す場合は目印だけ外す');
  L.push('                $html = str_replace( array( $open, $close ), \'\', $html );');
  L.push('            } else {');
  L.push('                // 条件に合わないブロックは丸ごと消す（必須欄ごと消えるので検証も通る）');
  L.push('                $html = preg_replace( $pattern, \'\', $html );');
  L.push('            }');
  L.push('        }');
  L.push('    }');
  L.push('');
  L.push('    // --- hidden に投稿の値を入れる ---');
  L.push('    $vals = nkk_cf7_dynamic_values();');
  L.push('    if ( isset( $vals[ $title ] ) && $post ) {');
  L.push('        foreach ( $vals[ $title ] as $field => $kind ) {');
  L.push('            switch ( $kind ) {');
  L.push('                case \'post_slug\':  $v = $post->post_name;  break;');
  L.push('                case \'post_title\': $v = $post->post_title; break;');
  L.push('                case \'post_id\':    $v = (string) $post->ID; break;');
  L.push('                default:            $v = \'\';');
  L.push('            }');
  // CF7 の hidden は modules/hidden.php で
  //   $atts = class, id, value, type, name → wpcf7_format_atts()
  // の順に組まれるため、**value が name より前に出る**。
  // 「name= のあとに value= が来る」と仮定した正規表現は一致せず、置換が黙って効かなかった
  // （実測: event-id がモックのべた書き値のままだった）。
  // 属性の順序を仮定せず、name を含む <input> タグを丸ごと取ってから value だけ差し替える。
  L.push('            $re = \'/<input\\b(?=[^>]*\\bname="\' . preg_quote( $field, \'/\' ) . \'")[^>]*>/\';');
  L.push('            $html = preg_replace_callback( $re, function ( $m ) use ( $v ) {');
  L.push('                $tag = $m[0];');
  L.push('                if ( preg_match( \'/\\bvalue="[^"]*"/\', $tag ) ) {');
  L.push('                    return preg_replace( \'/\\bvalue="[^"]*"/\', \'value="\' . esc_attr( $v ) . \'"\', $tag, 1 );');
  L.push('                }');
  L.push('                // value 属性が無い場合は足す');
  L.push('                return preg_replace( \'/\\s*\\/?>$/\', \' value="\' . esc_attr( $v ) . \'" />\', $tag, 1 );');
  L.push('            }, $html );');
  L.push('        }');
  L.push('    }');
  L.push('');
  L.push('');
  L.push('    // --- フォーム本文の中の data-acf を差し込む ---');
  // フォーム本文は文字列として保存されるので PHP を書けない。cf7.js が
  // <!--nkk-acf:キー:型--> の目印を埋め込んであるので、ここで実際の値に置き換える。
  // 目印はどのフォームにも共通の形なので、フォーム名で引く表は要らない。
  L.push('    if ( $post && function_exists( \'get_field\' ) ) {');
  L.push('        $html = preg_replace_callback(');
  L.push('            \'/<!--nkk-acf:([A-Za-z0-9_]+):([a-z]+)-->/\',');
  L.push('            function ( $m ) use ( $post ) {');
  L.push('                $v = get_field( $m[1], $post->ID );');
  L.push('                if ( null === $v || \'\' === $v ) { return \'\'; }');
  // wysiwyg は HTML を持つのでそのまま。それ以外は文字列として出す
  // （テキスト欄に <script> を入れられても実行されないようにする）。
  L.push('                return ( \'wysiwyg\' === $m[2] ) ? $v : esc_html( $v );');
  L.push('            },');
  L.push('            $html');
  L.push('        );');
  L.push('    }');
  L.push('');
  L.push('    return $html;');
  L.push('} );');
  L.push('');
  return L.join('\n');
}

module.exports = { generateCf7DynamicPhp };
