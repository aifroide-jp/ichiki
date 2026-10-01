'use strict';
// 回帰テスト: アンカー（#xxx）付きのリンクが、行き先の URL + #xxx になること。
//
// 実測（2026-09-30, maruya-mockup 案件）:
//   - メニューの #worries が '#worries' のままカスタムリンクに登録され、
//     メニューが出る他のページでは押しても何も起きなかった（src/converter/lib/gen/menus.js）
//   - 本文の index.html#contact が home_url('/') になり、#contact が消えていた。
//     「フォームへ」のボタンがトップの先頭に飛んでいた（src/converter/lib/link-resolve.js）
//
// fixture-anchor は maruya と同じ形: トップだけ共通ヘッダーにナビがあり、他のページは自前のヘッダー。
//
//   node test/converter-anchor-links.js

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmp = path.join(__dirname, '.tmp-out-anchor');
const out = path.join(tmp, 'ok');
let failed = false;

function fail(msg) {
  console.error(`NG: ${msg}`);
  failed = true;
}
function ok(msg) {
  console.log(`OK: ${msg}`);
}
function expect(cond, okMsg, ngMsg) {
  if (cond) ok(okMsg);
  else fail(ngMsg);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const r = spawnSync(
  'node',
  [path.join(root, 'src', 'converter', 'convert.js'), path.join(__dirname, 'fixture-anchor'), out],
  { encoding: 'utf8' }
);
if (r.status !== 0) {
  console.error(`NG: ビルドが失敗しました\n${r.stdout || ''}${r.stderr || ''}`);
  process.exit(1);
}
const read = (rel) => fs.readFileSync(path.join(out, rel), 'utf8');

// --- 1. メニュー: #spots はナビが書かれたページ（トップ）のアンカー ---
const seed = read('inc/seed-menus.php');
expect(
  seed.includes("array( 'label' => '自然スポット', 'parent' => -1, 'target' => array( 'front' => true ), 'hash' => '#spots' )"),
  'メニューの #spots はトップ + #spots で登録される',
  'メニューの #spots がトップのアンカーとして登録されていない（#spots のまま？）'
);
expect(
  seed.includes("'target' => array( 'page_id' => 'contact' ), 'hash' => '#contact' )"),
  'メニューの contact.html#contact は固定ページ + #contact で登録される',
  'メニューの contact.html#contact の #contact が消えている'
);
expect(
  seed.includes("$args['menu-item-url']  = $base . $item['hash'];"),
  'アンカー付きの項目はカスタムリンク（URL + #）で投入される',
  'seed-menus.php にアンカー付き項目の投入処理が無い'
);

// --- 2. 本文: index.html#spots の #spots が消えない ---
expect(
  read('page-contact.php').includes("esc_url( home_url( '/' ) . '#spots' )"),
  '本文の index.html#spots は home_url(\'/\') . \'#spots\' になる',
  '本文の index.html#spots の #spots が消えている'
);

// --- 3. 生成した PHP の構文と、同じページなら # だけにするフィルタの動作 ---
const php = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (php.status !== 0) {
  console.log('SKIP: php が無いので構文チェックとフィルタの実行は省略');
} else {
  for (const rel of ['functions.php', 'inc/seed-menus.php', 'page-contact.php']) {
    const l = spawnSync('php', ['-l', path.join(out, rel)], { encoding: 'utf8' });
    expect(l.status === 0, `${rel} の構文が正しい`, `${rel} の構文エラー\n${l.stdout}${l.stderr}`);
  }

  const fn = /function nkk_menu_same_page_anchor\([\s\S]*?\n}\n/.exec(read('functions.php'));
  if (!fn) {
    fail('functions.php に nkk_menu_same_page_anchor が無い');
  } else {
    // [表示中のURI, 項目のURL, 期待するURL]
    const cases = [
      ['/', 'https://example.test/#spots', '#spots'],
      ['/?utm=x', 'https://example.test/#spots', '#spots'],
      ['/', 'https://example.test/contact/#contact', 'https://example.test/contact/#contact'],
      ['/contact/', 'https://example.test/contact/#contact', '#contact'],
      ['/contact', 'https://example.test/contact/#contact', '#contact'],
      ['/contact/', 'https://example.test/#spots', 'https://example.test/#spots'],
      ['/', '#spots', '#spots'],
      ['/', '/#spots', '#spots'],
      ['/', 'https://other.test/#spots', 'https://other.test/#spots'],
      ['/', 'https://example.test/', 'https://example.test/'],
    ];
    const harness = [
      '<?php',
      'function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); }',
      'function wp_unslash( $v ) { return $v; }',
      "function trailingslashit( $s ) { return rtrim( $s, '/' ) . '/'; }",
      "function home_url( $p = '' ) { return 'https://example.test' . $p; }",
      fn[0],
      '$cases = json_decode( $argv[1], true );',
      '$out = array();',
      'foreach ( $cases as $c ) {',
      "    $_SERVER['REQUEST_URI'] = $c[0];",
      '    $item = (object) array( \'url\' => $c[1] );',
      '    nkk_menu_same_page_anchor( array( $item ) );',
      '    $out[] = $item->url;',
      '}',
      'echo json_encode( $out );',
    ].join('\n');
    const hf = path.join(tmp, 'harness.php');
    fs.writeFileSync(hf, harness);
    const h = spawnSync('php', [hf, JSON.stringify(cases)], { encoding: 'utf8' });
    let got = null;
    try {
      got = JSON.parse(h.stdout);
    } catch (e) {
      fail(`フィルタを実行できませんでした\n${h.stdout}${h.stderr}`);
    }
    if (got) {
      cases.forEach(([uri, url, want], i) => {
        expect(
          got[i] === want,
          `表示中 ${uri} / 項目 ${url} → ${want}`,
          `表示中 ${uri} / 項目 ${url} → ${got[i]}（期待: ${want}）`
        );
      });
    }
  }
}

if (failed) process.exit(1);
console.log('RESULT: アンカー付きのリンクは行き先の URL + # になっています');
