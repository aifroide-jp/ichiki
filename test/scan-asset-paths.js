'use strict';
// 回帰テスト: css/base.css・css/page/<id or cpt>.css・js/main.js（vocabulary.md 7章）が
// 無いとき、build まで待たず scan の時点で止まること。
//
// 経緯: lint・a11y・scan を「完成」の基準にしているモック作成プロンプトと、
// 実際に build が要求するファイルの集合がズレていた。build まで進んで
// 初めて「css/ ディレクトリが見つかりません」のように止まるのは手戻りが大きいため、
// 同じ検査を scan 側にも前倒しした（gen/functions.js と共有の asset-paths.js を使う）。
//
//   node test/scan-asset-paths.js

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmp = path.join(__dirname, '.tmp-out-scan-asset-paths');
let failed = false;

function fail(msg) {
  console.error(`NG: ${msg}`);
  failed = true;
}
function ok(msg) {
  console.log(`OK: ${msg}`);
}

function scan(mockup, outName) {
  const out = path.join(tmp, outName);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  return spawnSync('node', [path.join(root, 'src', 'scan.js'), mockup, out, '--project', outName], { encoding: 'utf8' });
}

fs.mkdirSync(tmp, { recursive: true });

// --- 1. test/fixture はそのまま(必要なファイルが揃っている): scan が通る ---
{
  const r = scan(path.join(__dirname, 'fixture'), 'ok');
  if (r.status === 0) ok('必要なファイルが揃っているフィクスチャは scan が通る');
  else fail(`揃っているはずのフィクスチャで scan が失敗した\n${r.stdout || ''}${r.stderr || ''}`);
}

// --- 2. css/page/spot.css を欠かせたコピー: build を待たず scan で止まる ---
{
  const mockup = path.join(tmp, 'missing-css-src');
  fs.rmSync(mockup, { recursive: true, force: true });
  fs.cpSync(path.join(__dirname, 'fixture'), mockup, { recursive: true });
  fs.rmSync(path.join(mockup, 'css', 'page', 'spot.css'));

  const r = scan(mockup, 'missing-css');
  const combined = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status === 0) {
    fail('css/page/spot.css が無いのに scan が成功した(build まで気づけない状態に逆戻りしている)');
  } else if (!/css\/page\/spot\.css が見つかりません/.test(combined)) {
    fail(`scan は失敗したが、期待したエラー文言(css/page/spot.css が見つかりません)が出ていない\n${combined}`);
  } else {
    ok('css/page/spot.css の欠落を scan の時点で検出した');
  }
}

// --- 3. js/main.js を欠かせたコピー: 同様に scan で止まる ---
{
  const mockup = path.join(tmp, 'missing-js-src');
  fs.rmSync(mockup, { recursive: true, force: true });
  fs.cpSync(path.join(__dirname, 'fixture'), mockup, { recursive: true });
  fs.rmSync(path.join(mockup, 'js', 'main.js'));

  const r = scan(mockup, 'missing-js');
  const combined = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status === 0) {
    fail('js/main.js が無いのに scan が成功した');
  } else if (!/js\/main\.js が見つかりません/.test(combined)) {
    fail(`scan は失敗したが、期待したエラー文言(js/main.js が見つかりません)が出ていない\n${combined}`);
  } else {
    ok('js/main.js の欠落を scan の時点で検出した');
  }
}

if (failed) {
  process.exit(1);
}
console.log('RESULT: css/js の固定パス欠落は build を待たず scan で検出されます');
