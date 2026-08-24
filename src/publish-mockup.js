#!/usr/bin/env node
'use strict';

// 合意したモックを、公開サイトの配下に置く（検収用）。
//
// なぜ要るか:
//   検収の「見た目はモックアップ通りに見えますか？」は、L1 が**モックを見られないと
//   答えられない**。localhost で配信しても L1 からは見えないので、
//   検収ガイドに画像を22枚埋めていた（4.7MB）。
//   モックは相対パスで自己完結している（vocabulary.md 7章・8章）ので、
//   フォルダを公開サイトの下に置くだけで動く。置けば:
//     - 検収シートに「実際のページ」と「合意したデザイン」の URL を2つ持たせられる
//     - 画像の埋め込みが要らなくなる
//     - スマホでも実物を見比べられる（画像だと拡大縮小がつらい）
//
// 検索エンジン対策:
//   モックの各ページは <meta name="robots" content="noindex, nofollow"> を持っている
//   （lint L?? では強制していないが、実測で12/12ページにある）。
//   持たないページがあれば警告する。サーバ設定に頼らないほうが確実。
//
// **検収が終わったら消す。** --remove で消せる。

const fs = require('fs');
const path = require('path');
const { readConfig } = require('./shared/project-config');
const { findHtmlFiles } = require('./shared/discover');

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const ROOT = process.cwd();
const { conf } = readConfig(ROOT);

const MOCKUP = path.resolve(ROOT, conf.mockup || './');
// 置き先。既定は公開サイトのドキュメントルート直下 _mockup。
// theme_dir から wp-content/themes/... を遡ってドキュメントルートを出す。
function docRoot() {
  const td = conf.theme_dir || '';
  const i = td.indexOf(`${path.sep}wp-content${path.sep}themes${path.sep}`);
  return i > 0 ? td.slice(0, i) : null;
}
const dest = positional[0]
  ? path.resolve(ROOT, positional[0])
  : docRoot()
    ? path.join(docRoot(), '_mockup')
    : null;

if (!dest) {
  console.error('置き先が分かりません。引数で渡すか、.ichiki.json の theme_dir を書いてください。');
  console.error('使い方: ichiki publish-mockup [置き先] [--remove]');
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
  const base = (conf.site_url || '').replace(/\/$/, '');
  if (base) console.log(`  ${base}/${path.basename(dest)}/`);
  if (noRobots.length) {
    console.log('');
    console.log(`※ <meta name="robots" content="noindex"> が無いページが ${noRobots.length}件あります。`);
    for (const f of noRobots.slice(0, 5)) console.log(`     ${f.rel}`);
    console.log('   検索エンジンに拾われる可能性があります。モックに meta を足してください。');
  }
  console.log('');
  console.log('検収が終わったら `ichiki publish-mockup --remove` で消してください。');
}

main();
