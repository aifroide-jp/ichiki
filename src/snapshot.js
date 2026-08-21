#!/usr/bin/env node
'use strict';

// 出力を丸ごと凍結して、変わったら落とす（回帰ハーネス）。
//
//   node src/snapshot.js            … 期待値と比較。1バイトでも違えば非ゼロ終了
//   node src/snapshot.js --update   … 期待値を現在の出力で更新（意図した変更のときだけ）
//
// なぜ要るか:
//   Ichiki 本体へ移設するとき、**動かしてみて目で見る**では変化に気づけない。
//   実測で、the_field() の名前引き・CF7 内の死んだフィールド・Web フォントの欠落・
//   共通ヘッダーで出ていた申込ページは、どれも生成物を読むまで分からなかった。
//   凍結してあれば、移設した瞬間に「どのファイルがどう変わったか」が出る。
//
// 前提: scan も変換も決定的（同じ入力なら毎回同じ出力）。実測で確認済み。
//
// 移設後もこのまま使える。走らせるコマンドを差し替えれば、
// **移設前後で出力がバイト単位同一か**を確かめられる。
//   ICHIKI_SCAN="node …/scan.js"  ICHIKI_BUILD="node …/build.js"  node src/snapshot.js

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 凍結の対象は**案件のモック**。期待値も案件側に置く（案件ごとに中身が違うため）。
//   node src/snapshot.js <mockupDir> <expected.json> [--update]
const SRC = __dirname;
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const MOCKUP = args[0];
const EXPECTED = args[1];
const UPDATE = process.argv.includes('--update');
if (!MOCKUP || !EXPECTED) {
  console.error('使い方: node src/snapshot.js <mockupDir> <expected.json> [--update]');
  process.exit(2);
}

// assets（画像・CSS・JS）は中身を凍結しない。41MB あり、リポジトリが重くなる。
// **画像が落ちたかどうかは ichiki diff の差異率で分かる**ので、
// ここではファイルの有無とサイズだけ見る（消えた・入れ替わったは検出できる）。
const CONTENT_SKIP = /(^|\/)assets\//;

// 中身は見るが、**日付など毎回変わる箇所は伏せてから**ハッシュを取る。
// 伏せないと、コードを1行も触っていない翌日に凍結が落ちる（実測で落ちた）。
// 回帰ハーネスが日付で落ちると、本当の差分が埋もれて誰も見なくなる。
const VOLATILE = [
  // 案件用 CLAUDE.md の生成日（templates/CLAUDE.md.tmpl の {{GENERATED}}）
  [/generated: \d{4}-\d{2}-\d{2}/g, 'generated: <date>'],
];

function normalize(buf) {
  let t = buf.toString('utf8');
  for (const [re, to] of VOLATILE) t = t.replace(re, to);
  return Buffer.from(t, 'utf8');
}

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

function manifestOf(dir) {
  const m = {};
  for (const rel of walk(dir)) {
    const buf = fs.readFileSync(path.join(dir, rel));
    m[rel] = CONTENT_SKIP.test(rel) ? `size:${buf.length}` : sha(normalize(buf));
  }
  return m;
}

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`${label} が失敗しました:\n${(r.stdout || '') + (r.stderr || '')}`);
    process.exit(2);
  }
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nkk-snap-'));
  const scanOut = path.join(tmp, 'scan');
  const themeOut = path.join(tmp, 'theme');

  // 走らせるコマンドは差し替え可能にする（移設後の出力と突き合わせるため）
  const scanCmd = process.env.ICHIKI_SCAN || `node ${path.join(SRC, 'scan.js')}`;
  const buildCmd = process.env.ICHIKI_BUILD || `node ${path.join(SRC, 'converter', 'convert.js')}`;
  const sp = scanCmd.split(' ');
  const bp = buildCmd.split(' ');

  // scan も変換器と同じ読み取りを使うので、同じ逃げ道が要る。
  // 渡していなかったため、モックが未完成の間はスナップショットが取れなかった。
  run('scan', sp[0], [...sp.slice(1), MOCKUP, scanOut, '--allow-unresolved-links']);
  run('変換', bp[0], [...bp.slice(1), MOCKUP, themeOut, '--allow-unresolved-links']);

  const got = { scan: manifestOf(scanOut), theme: manifestOf(themeOut) };

  if (UPDATE) {
    fs.mkdirSync(path.dirname(EXPECTED), { recursive: true });
    fs.writeFileSync(EXPECTED, JSON.stringify(got, null, 2) + '\n');
    const n = Object.keys(got.scan).length + Object.keys(got.theme).length;
    console.log(`期待値を更新しました: ${n} ファイル -> ${path.relative(process.cwd(), EXPECTED)}`);
    process.exit(0);
  }

  if (!fs.existsSync(EXPECTED)) {
    console.error('期待値がありません。`node src/snapshot.js --update` で作成してください');
    process.exit(2);
  }
  const exp = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));

  let bad = 0;
  for (const group of ['scan', 'theme']) {
    const a = exp[group] || {};
    const b = got[group] || {};
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (!(k in b)) { console.log(`  [消えた]   ${group}/${k}`); bad++; }
      else if (!(k in a)) { console.log(`  [増えた]   ${group}/${k}`); bad++; }
      else if (a[k] !== b[k]) { console.log(`  [変わった] ${group}/${k}`); bad++; }
    }
  }

  const total = Object.keys(got.scan).length + Object.keys(got.theme).length;
  if (bad === 0) {
    console.log(`OK: ${total} ファイルが期待値と一致しました`);
    process.exit(0);
  }
  console.log('');
  console.log(`NG: ${bad} ファイルが期待値と違います（全 ${total} ファイル）`);
  console.log('意図した変更なら `node src/snapshot.js --update` で凍結し直してください。');
  console.log('**中身の差分は git diff で見ること。**ここは「変わった」までしか言わない。');
  process.exit(1);
}

main();
