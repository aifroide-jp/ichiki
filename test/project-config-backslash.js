'use strict';
// 回帰テスト: .ichiki.json に Windows パスをそのまま貼ったときの検出。
//
// 経緯: 単一の `\`（バックスラッシュ）は JSON では \t \n のような制御文字の
// エスケープと解釈される。`\p` のように無効な組み合わせならパースエラーになるが、
// `\t` `\n` `\r` のような「たまたま有効に見える」組み合わせは**エラーにならず、
// 値が静かに壊れる**（実測: "C:\temp\newsite" が読み込むとタブ文字・改行文字を
// 含む壊れた文字列になっていた）。
//
//   node test/project-config-backslash.js

const fs = require('fs');
const path = require('path');
const { hasSuspiciousBackslash, readConfig } = require('../src/shared/project-config');

let failed = false;
function check(name, got, want) {
  if (got === want) {
    console.log(`OK: ${name}`);
  } else {
    console.error(`NG: ${name}\n  got : ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
    failed = true;
  }
}

// --- hasSuspiciousBackslash() の判定 ---
check(
  '正しくエスケープされた \\\\ は誤検知しない',
  hasSuspiciousBackslash(JSON.stringify({ wp_root: 'C:\\Users\\name\\Local Sites' })),
  false
);
check(
  'フォワードスラッシュは誤検知しない',
  hasSuspiciousBackslash(JSON.stringify({ wp_root: 'C:/Users/name/Local Sites' })),
  false
);
check(
  '単一の \\（\\p のように無効なエスケープ）を検出する',
  hasSuspiciousBackslash('{"wp_root": "C:\\temp\\project"}'),
  true
);
check(
  '単一の \\（\\t \\n のようにパースは通ってしまうものも検出する）',
  hasSuspiciousBackslash('{"wp_root": "C:\\temp\\newsite"}'),
  true
);

// --- readConfig() が実際に静かな破損を警告する（パース自体は通ってしまう）---
{
  const tmp = path.join(__dirname, '.tmp-out-backslash');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, '.ichiki.json'), '{\n  "project": "test",\n  "wp_root": "C:\\temp\\newsite"\n}\n');

  const origError = console.error;
  const logged = [];
  console.error = (msg) => logged.push(msg);
  let conf;
  try {
    ({ conf } = readConfig(tmp));
  } finally {
    console.error = origError;
  }

  const warned = logged.some((m) => String(m).includes('バックスラッシュ'));
  check('readConfig() が破損の可能性を警告する', warned, true);

  const corrupted = conf.wp_root.includes('\t') || conf.wp_root.includes('\n');
  check('（参考）警告した通り、値は実際に制御文字を含んで壊れている', corrupted, true);
}

if (failed) process.exit(1);
console.log('RESULT: Windows パスの単一バックスラッシュを検出できています');
