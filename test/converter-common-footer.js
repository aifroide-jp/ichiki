'use strict';
// 回帰テスト: </footer> と </body> の間に置いた data-common が消えないこと。
//
// 実測（2026-08-27, monda-mockup-plan-a 案件）: <header>と<main>の間には
// renderBetween() があるのに、</footer>と</body>の間には対になる処理が無く、
// そこに置いた data-common="mobile_cta"（フロートCTA等）が
//   - template-parts/common-mobile_cta.php としてファイルは作られるのに
//   - それを呼ぶ get_template_part() がどこにも生成されず
//   - 中身も the_field() ではなくモックの文言が焼き込まれたまま
// という二重に静かな失敗になっていた（src/converter/lib/gen/templates.js,
// src/converter/lib/render.js）。
//
//   node test/converter-common-footer.js

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmp = path.join(__dirname, '.tmp-out-common-footer');
let failed = false;

function fail(msg) {
  console.error(`NG: ${msg}`);
  failed = true;
}
function ok(msg) {
  console.log(`OK: ${msg}`);
}

function build(fixtureName, outName) {
  const mockup = path.join(__dirname, fixtureName);
  const out = path.join(tmp, outName);
  fs.rmSync(out, { recursive: true, force: true });
  return spawnSync('node', [path.join(root, 'src', 'converter', 'convert.js'), mockup, out], { encoding: 'utf8' });
}

function readAll(dir) {
  const out = new Map();
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out.set(path.relative(dir, f), fs.readFileSync(f, 'utf8'));
    }
  })(dir);
  return out;
}

fs.mkdirSync(tmp, { recursive: true });

// --- 1. data-common="mobile_cta" を宣言したケース: ビルドが通り、消えずに出力される ---
{
  const out = path.join(tmp, 'ok');
  const r = build('fixture-common-footer', 'ok');
  if (r.status !== 0) {
    fail(`宣言済みのケースでビルドが失敗しました\n${r.stdout || ''}${r.stderr || ''}`);
  } else {
    const files = readAll(out);

    // (a) the_field()/get_field() が実際に出力に存在する（モックの文言が焼き込まれていない）
    const hasField = [...files.values()].some((c) => /the_field\(\s*'field_site_options_mobile_cta_label'/.test(c) || /get_field\(\s*'field_site_options_mobile_cta_label'/.test(c));
    if (hasField) ok('mobile_cta_label が the_field()/get_field() として出力されている');
    else fail('mobile_cta_label が the_field()/get_field() として出力されていない（文言が焼き込まれたまま？）');

    // (b) template-parts/common-mobile_cta.php を作ったなら、誰かが get_template_part() で呼んでいる
    //     （footer.php に直接展開されて template-parts 自体が無い、でも正しい）
    const partFile = 'template-parts/common-mobile_cta.php';
    if (files.has(partFile)) {
      const referenced = [...files.entries()].some(([rel, c]) => rel !== partFile && c.includes("get_template_part( 'template-parts/common-mobile_cta'"));
      if (referenced) ok(`${partFile} は get_template_part() から到達可能`);
      else fail(`${partFile} を生成したのに、どこからも get_template_part() されていない（孤立ファイル）`);
    } else {
      ok('template-parts/common-mobile_cta.php は作られず、footer.php に直接展開された');
    }
  }
}

// --- 2. data-common を宣言しなかったケース: 黙って消えず、エラーで止まる ---
{
  const r = build('fixture-common-footer-missing-decl', 'missing-decl');
  const combined = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status === 0) {
    fail('data-common を宣言していないのにビルドが成功した(黙ってフォールバックしている)');
  } else if (!/data-common がありません/.test(combined)) {
    fail(`ビルドは失敗したが、期待したエラー文言(data-common がありません)が出ていない\n${combined}`);
  } else {
    ok('data-common 未宣言のケースは、期待通りエラーで止まった');
  }
}

if (failed) {
  process.exit(1);
}
console.log('RESULT: </footer> と </body> の間の data-common は正しく扱われています');
