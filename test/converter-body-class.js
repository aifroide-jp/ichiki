'use strict';
// 回帰テスト: モックの <body class> が生成テーマまで運ばれること。
//
// 実測（maruya案件）: <body class="p-interview-page"> を書いたページを変換すると、
// テンプレートが <body <?php body_class(); ?>> を無条件に出していたため class が
// 消え、verify:structure が「欠落 1件: p-interview-page」で停止していた。
// モック側の不備ではなく変換器の穴で、「モックと1:1」が <body> だけ破れていた。
//
// class="…" の literal として出すことも合わせて見る。PHP 関数の引数
// （get_body_class( 'x' )）に隠すと verify:structure の class="…" 走査から
// 見えなくなり、直したのに欠落と報告され続けるため。
//
//   node test/converter-body-class.js

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmp = path.join(__dirname, '.tmp-out-body-class');
const fixture = path.join(__dirname, 'fixture-body-class');
let failed = false;

function fail(msg) {
  console.error(`NG: ${msg}`);
  failed = true;
}
function ok(msg) {
  console.log(`OK: ${msg}`);
}

function build(mockup, outName) {
  const out = path.join(tmp, outName);
  fs.rmSync(out, { recursive: true, force: true });
  const r = spawnSync('node', [path.join(root, 'src', 'converter', 'convert.js'), mockup, out], {
    encoding: 'utf8',
  });
  return { r, out };
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

// --- 1. 共通ヘッダー側と自前シェル側の両方で class が運ばれる ---
const { r: built, out } = build(fixture, 'ok');
if (built.status !== 0) {
  fail(`ビルドが失敗しました\n${built.stdout || ''}${built.stderr || ''}`);
} else {
  const cases = [
    ['header.php', 'site-shell', '共通ヘッダー（全ページ一致）'],
    ['page-standalone.php', 'p-standalone', '自前シェルのページ'],
  ];
  for (const [file, cls, label] of cases) {
    const text = fs.readFileSync(path.join(out, file), 'utf8');
    if (new RegExp(`<body class="${cls}[ "]`).test(text)) ok(`${label}: ${file} が class="${cls} …" を出している`);
    else fail(`${label}: ${file} に class="${cls}" が literal で出ていない\n      ${text.split('\n').find((l) => l.includes('<body')) || '(<body> が無い)'}`);
  }

  // 属性値にクォートを持ち込んでいないこと（持ち込むと verify:structure の
  // class="…" 走査が属性ごと読み飛ばし、欠落として報告され続ける）
  const headerText = fs.readFileSync(path.join(out, 'header.php'), 'utf8');
  const bodyLine = headerText.split('\n').find((l) => l.includes('<body')) || '';
  const attr = (bodyLine.match(/class\s*=\s*"([^"]*)"/) || [])[1];
  if (attr !== undefined && !attr.includes("'")) ok('<body> の class 属性にクォートが入っていない');
  else fail(`<body> の class 属性がクォートを含む/取り出せない: ${bodyLine}`);

  // --- 2. verify:structure が欠落0で通る（本来の検出者による確認）---
  const v = spawnSync('node', [path.join(root, 'src', 'verify', 'structure.js'), fixture, out], {
    encoding: 'utf8',
  });
  if (v.status === 0) ok('verify:structure が欠落0で通った');
  else fail(`verify:structure が通らなかった\n${v.stdout || ''}${v.stderr || ''}`);
}

// --- 3. 共通ヘッダーを使うページで class が食い違ったら、推測せず停止する ---
{
  const mismatch = path.join(tmp, 'fixture-mismatch');
  fs.cpSync(fixture, mismatch, { recursive: true });
  const target = path.join(mismatch, 'contact.html');
  fs.writeFileSync(
    target,
    fs.readFileSync(target, 'utf8').replace('<body class="site-shell"', '<body class="site-other"'),
    'utf8'
  );
  const { r } = build(mismatch, 'mismatch');
  const combined = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status === 0) {
    fail('共通ヘッダーのページ間で <body> の class が食い違っているのにビルドが成功した');
  } else if (!/<body> の class が食い違っています/.test(combined)) {
    fail(`ビルドは失敗したが、期待したエラー文言が出ていない\n${combined}`);
  } else {
    ok('class が食い違うケースは、期待通りエラーで止まった');
  }
}

if (failed) {
  process.exit(1);
}
console.log('RESULT: モックの <body class> は生成テーマまで運ばれています');
