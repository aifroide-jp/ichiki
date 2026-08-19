#!/usr/bin/env node
'use strict';

// 案件側の受け入れ状態を見る。
//   node src/doctor.js [案件ルート]
//
// なぜ要るか:
//   Ichiki は submodule で、スラッシュコマンドは .claude/commands/ に**コピー**して使う
//   （Claude Code が .claude/commands/ しか見ないため）。
//   本体を更新してコピーを忘れると、**古い手順が動き続ける**。しかも静かに。
//   実測: commands/run.md を新しい手順に書き換えたのに、案件側は8月5日のコピーのままで、
//   /run を叩けば「AI が1ページずつテンプレートを書く」旧手順が動く状態だった。
//   書き換えた本人（私）が塞げたと思い込んでいた。
//
//   コピーをやめる案もあったが、更新手順を踏めば済む話ではある。
//   **踏み忘れても気づけるようにする**のがここの役目。

const fs = require('fs');
const path = require('path');

const ICHIKI = path.join(__dirname, '..');
const ROOT = path.resolve(process.argv[2] || process.cwd());
const VERSION = JSON.parse(fs.readFileSync(path.join(ICHIKI, 'package.json'), 'utf8')).version;

const problems = [];
const notes = [];

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function ng(msg, how) {
  console.log(`✗ ${msg}`);
  problems.push(how);
}

// 1. 本体の依存
if (fs.existsSync(path.join(ICHIKI, 'node_modules', 'cheerio'))) {
  ok('Ichiki の依存が入っている');
} else {
  ng('Ichiki の依存が入っていない', `cd ${path.relative(ROOT, ICHIKI) || '.'} && npm install`);
}

// 2. .ichiki.json
const confPath = path.join(ROOT, '.ichiki.json');
let conf = null;
if (fs.existsSync(confPath)) {
  try {
    conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    ok('.ichiki.json がある');
  } catch (e) {
    ng('.ichiki.json が壊れている（JSON として読めない）', '書式を直してください');
  }
} else {
  ng('.ichiki.json が無い', 'README の「はじめに」を見て作成してください');
}

// 3. バージョンの記録と一致
if (conf) {
  if (!conf.ichiki_version) {
    ng('.ichiki.json に ichiki_version が無い', `"ichiki_version": "${VERSION}" を書いてください`);
  } else if (conf.ichiki_version !== VERSION) {
    ng(
      `バージョン不一致（案件は ${conf.ichiki_version} を想定 / 本体は ${VERSION}）`,
      'submodule のコミットを合わせるか .ichiki.json を更新してください'
    );
  } else {
    ok(`バージョンが一致している（${VERSION}）`);
  }
  if (!conf.mockup) notes.push('.ichiki.json に mockup が無い（コマンドで毎回パスを渡すことになる）');
}

// 4. スラッシュコマンドのコピーが本体と同じか
const srcDir = path.join(ICHIKI, 'commands');
const dstDir = path.join(ROOT, '.claude', 'commands');
if (fs.existsSync(srcDir)) {
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));
  const stale = [];
  const missing = [];
  for (const f of files) {
    const dst = path.join(dstDir, f);
    if (!fs.existsSync(dst)) {
      missing.push(f);
    } else if (fs.readFileSync(dst, 'utf8') !== fs.readFileSync(path.join(srcDir, f), 'utf8')) {
      stale.push(f);
    }
  }
  const extra = fs.existsSync(dstDir)
    ? fs.readdirSync(dstDir).filter((f) => f.endsWith('.md') && !files.includes(f))
    : [];

  if (!stale.length && !missing.length && !extra.length) {
    ok(files.length ? `スラッシュコマンドのコピーが本体と一致している（${files.length}件）` : 'スラッシュコマンドは使っていない');
  } else {
    if (stale.length) ng(`コピーが古い: ${stale.join(', ')}`, `cp ${path.relative(ROOT, srcDir)}/*.md .claude/commands/`);
    if (missing.length) ng(`コピーが無い: ${missing.join(', ')}`, `cp ${path.relative(ROOT, srcDir)}/*.md .claude/commands/`);
    if (extra.length) ng(`本体に無いコマンドが残っている: ${extra.join(', ')}`, `.claude/commands/ から削除してください`);
  }
}

for (const n of notes) console.log(`  ※ ${n}`);

if (problems.length) {
  console.log('');
  console.log('直し方:');
  for (const p of [...new Set(problems)]) console.log(`  ${p}`);
  process.exit(1);
}
console.log('');
console.log('問題ありません。');
