'use strict';

// nav-structure.js が読み取ったテンプレートから、theme_location ごとの Walker を生成する。
//
// モックに書かれた nav の形をそのまま型として持ち、そこに wp-admin のメニュー項目を
// 流し込む。形を分類しないので、ドロップダウンでもアコーディオンでも何階層でも通る。
//
// Walker の start_el/end_el を使わず walk() を丸ごと実装しているのは、骨組みの中の
// 「項目が入る場所」が複数あり得るため(フッターの列組み等)。逐次出力では列の境目を
// 跨げない。walk() は $elements(menu_item_parent 付きの全項目)を受け取るので、
// そこから木を組んで自分で描画する。
//
// functions.js から切り出してあるのは、生成PHPを単体でテストできるようにするため
// (model 全体を用意せずに済む)。

const { phpSingleQuote, navWalkerClass } = require('../php-util');

function generateNavWalkers(navInfo) {
  const lines = [];

  for (const [name, info] of navInfo) {
    if (!info || info.kind !== 'template') continue;
    const cls = navWalkerClass(name);
    const q = (v) => (v ? phpSingleQuote(v) : "''");

    lines.push('/**');
    lines.push(` * data-nav="${name}" の形を再現する Walker。モックから機械生成。`);
    lines.push(' * 骨組みの {{SLOT}} に項目が入る。slots は各スロットの定員(モック実測値)で、');
    lines.push(' * 最後のスロットには残りを全部入れる(お客様が項目を増やしても落とさない)。');
    lines.push(' */');
    lines.push(`class ${cls} extends Walker_Nav_Menu {`);
    lines.push(`    private $skeleton = ${phpSingleQuote(info.skeleton)};`);
    lines.push(`    private $slots = array( ${info.slots.join(', ')} );`);
    lines.push('    private $levels = array(');
    for (const lv of info.levels) {
      lines.push(
        `        array( 'parent' => ${q(lv.parentTemplate)}, 'title' => ${q(lv.titleTemplate)}, ` +
          `'open' => ${q(lv.childrenOpen)}, 'close' => ${q(lv.childrenClose)}, 'leaf' => ${q(lv.leafTemplate)} ),`
      );
    }
    lines.push('    );');
    lines.push('');
    lines.push('    public function walk( $elements, $max_depth, ...$args ) {');
    lines.push('        $tree = array();');
    lines.push('        foreach ( (array) $elements as $e ) {');
    lines.push('            $pid = (int) $e->menu_item_parent;');
    lines.push('            if ( ! isset( $tree[ $pid ] ) ) { $tree[ $pid ] = array(); }');
    lines.push('            $tree[ $pid ][] = $e;');
    lines.push('        }');
    lines.push('        $top = isset( $tree[0] ) ? $tree[0] : array();');
    lines.push("        $parts = explode( '{{SLOT}}', $this->skeleton );");
    lines.push('        $last = count( $parts ) - 1;');
    lines.push("        $out = '';");
    lines.push('        $i = 0;');
    lines.push('        foreach ( $parts as $n => $chunk ) {');
    lines.push('            $out .= $chunk;');
    lines.push('            if ( $n >= $last ) { break; }');
    lines.push('            $cap = ( $n === $last - 1 )');
    lines.push('                ? count( $top ) - $i');
    lines.push('                : ( isset( $this->slots[ $n ] ) ? $this->slots[ $n ] : 0 );');
    lines.push('            for ( $k = 0; $k < $cap && $i < count( $top ); $k++, $i++ ) {');
    lines.push('                $out .= $this->nkk_item( $top[ $i ], $tree, 0 );');
    lines.push('            }');
    lines.push('        }');
    lines.push('        return $out;');
    lines.push('    }');
    lines.push('');
    lines.push('    private function nkk_item( $item, $tree, $depth ) {');
    lines.push('        $lv = isset( $this->levels[ $depth ] ) ? $this->levels[ $depth ] : end( $this->levels );');
    lines.push('        $kids = isset( $tree[ (int) $item->ID ] ) ? $tree[ (int) $item->ID ] : array();');
    lines.push("        $find = array( '{{URL}}', '{{TEXT}}' );");
    lines.push('        $repl = array( esc_url( $item->url ), esc_html( $item->title ) );');
    if (info.currentClass) {
      // data-nav-current: 現在ページのリンクに付ける class（vocabulary.md 5.1）。
      // WordPress が current-menu-item / -parent / -ancestor を $item->classes に
      // 入れてくれるので、こちらで URL を突き合わせる必要はない。
      // メニュー項目を参照型（page_id / post_type_archive 等）で登録しているから成立する。
      const c = info.currentClass;
      lines.push('        $nkk_cur = (array) $item->classes;');
      lines.push("        $nkk_on = (bool) array_intersect( $nkk_cur, array( 'current-menu-item', 'current-menu-parent', 'current-menu-ancestor' ) );");
      // WordPress は post_type_archive の項目を「その CPT の詳細を見ているとき」には
      // 現在地として扱わない。だが一覧項目はその投稿タイプそのものを指しているので、
      // 詳細ページでもハイライトするのが自然（実測: 元モックの events/sample.html は
      // 「イベントを探す」に class="active" を付けていた）。
      lines.push("        if ( ! $nkk_on && 'post_type_archive' === $item->type && is_singular( $item->object ) ) { $nkk_on = true; }");
      lines.push(`        $find[] = '{{CURRENT_ATTR}}'; $repl[] = $nkk_on ? ' class="${c}"' : '';`);
      lines.push(`        $find[] = '{{CURRENT}}'; $repl[] = $nkk_on ? ' ${c}' : '';`);
    }
    lines.push("        if ( empty( $kids ) || '' === $lv['parent'] ) {");
    lines.push("            if ( '' !== $lv['leaf'] ) {");
    lines.push("                return str_replace( $find, $repl, $lv['leaf'] );");
    lines.push('            }');
    lines.push('            // 子なしの型が無い階層(モックでは全項目が子を持っていた場合)は、');
    lines.push('            // 子ありの型を空の子リストで使う。項目を落とさないため。');
    lines.push("            return str_replace(");
    lines.push("                array( '{{TITLE}}', '{{CHILDREN}}' ),");
    lines.push("                array( str_replace( $find, $repl, $lv['title'] ), $lv['open'] . $lv['close'] ),");
    lines.push("                $lv['parent']");
    lines.push('            );');
    lines.push('        }');
    lines.push("        $children = '';");
    lines.push('        foreach ( $kids as $kid ) {');
    lines.push('            $children .= $this->nkk_item( $kid, $tree, $depth + 1 );');
    lines.push('        }');
    lines.push('        return str_replace(');
    lines.push("            array( '{{TITLE}}', '{{CHILDREN}}' ),");
    lines.push("            array( str_replace( $find, $repl, $lv['title'] ), $lv['open'] . $children . $lv['close'] ),");
    lines.push("            $lv['parent']");
    lines.push('        );');
    lines.push('    }');
    lines.push('}');
    lines.push('');
  }

  return lines;
}

module.exports = { generateNavWalkers };
