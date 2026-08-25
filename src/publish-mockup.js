#!/usr/bin/env node
'use strict';

// 合意したモックを、任意の場所に配る。
//
// 誰のためか:
//   **お客様**のため。合意までの間、モックを見てもらう必要がある。
//   渡し方は「HTML を直渡し」か「検証サーバに設置」の2つで、後者がこれ。
//
//   検収する社内スタッフには要らない。スタッフはリポジトリを落として作業するので、
//   モックは手元にファイルとしてある（検収シートの「合意したデザイン」列は
//   file:// でそこを指す）。公開サイトに置くと41MBが乗るうえ、
//   消し忘れの管理も要る。置かないほうがよい。
//
//   モックは相対パスで自己完結している（vocabulary.md 7章・8章）ので、
//   フォルダを置くだけで動く。
//
// 検索エンジン対策:
//   モックの各ページは <meta name="robots" content="noindex, nofollow"> を持っている
//   （lint では強制していないが、実測で12/12ページにある）。
//   持たないページがあれば警告する。サーバ設定に頼らないほうが確実。
//
// **見せ終わったら消す。** --remove で消せる。

const fs = require('fs');
const path = require('path');
const { readConfig } = require('./shared/project-config');
const { findHtmlFiles } = require('./shared/discover');

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const ROOT = process.cwd();
const { conf } = readConfig(ROOT);

const MOCKUP = path.resolve(ROOT, conf.mockup || './');
// 置き先は**必ず指定させる**。既定を持たせない。
// 相手も置き場所も案件ごとに違う（お客様の検証サーバ・社内サーバ・共有フォルダ）。
// 既定を WordPress のドキュメントルートにしていたが、それは検収用と勘違いしていた頃の名残。
const dest = positional[0] ? path.resolve(ROOT, positional[0]) : null;

if (!dest) {
  console.error('置き先を指定してください。');
  console.error('使い方: ichiki publish-mockup <置き先> [--remove]');
  console.error('  例: ichiki publish-mockup /path/to/検証サーバ/mockup');
  process.exit(2);
}

if (argv.includes('--remove')) {
  if (!fs.existsSync(dest)) {
    console.log(`置かれていません: ${dest}`);
    process.exit(0);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  console.log(`削除しました: ${dest}`);
  process.exit(0);
}

// モックに含めるもの。ページと、ページが参照するもの。
const KEEP = /\.(html|css|js|png|jpe?g|svg|webp|gif|avif|mp4|webm|ico|woff2?|ttf|otf)$/i;
// モックでないディレクトリは discover と同じ規則で外す（成果物を公開してしまわないため）
const SKIP = new Set(['node_modules', ...(conf.not_mockup || ['docs', 'scripts'])]);

function copyTree(srcRoot, dstRoot) {
  let n = 0;
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(srcRoot, rel), { withFileTypes: true })) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const r = path.join(rel, e.name);
      if (e.isDirectory()) {
        fs.mkdirSync(path.join(dstRoot, r), { recursive: true });
        walk(r);
      } else if (KEEP.test(e.name)) {
        fs.copyFileSync(path.join(srcRoot, r), path.join(dstRoot, r));
        n++;
      }
    }
  })('');
  return n;
}

function main() {
  // noindex を持たないページを先に警告する。置いてから気づくと手遅れになりうる。
  const noRobots = findHtmlFiles(MOCKUP).filter(
    (f) => !/name=["']robots["'][^>]*noindex/i.test(fs.readFileSync(f.abs, 'utf8'))
  );

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const n = copyTree(MOCKUP, dest);

  console.log(`モックを置きました: ${dest}`);
  console.log(`  ${n} ファイル`);

  if (noRobots.length) {
    console.log('');
    console.log(`※ <meta name="robots" content="noindex"> が無いページが ${noRobots.length}件あります。`);
    for (const f of noRobots.slice(0, 5)) console.log(`     ${f.rel}`);
    console.log('   検索エンジンに拾われる可能性があります。モックに meta を足してください。');
  }
  console.log('');
  console.log(`見せ終わったら \`ichiki publish-mockup ${positional[0]} --remove\` で消してください。`);
}

main();
