'use strict';

// モックの *.html を集める。**唯一の実装。**
//
// lint と変換器が別々に持っていて、除外するディレクトリがズレていた
// （lint は scripts/ を外し、変換器は外していなかった）。
// モックの置き場所がリポジトリのルートになると、この差がそのまま
// 「lint は通るが変換で落ちる」になる。
//
// 成果物の置き場所（docs/ など）を走査すると、生成した HTML をモックのページとして
// 拾ってしまう。実測: `ichiki diff` が出す比較レポート docs/visual/index.html を
// 拾って lint が242件のエラーを出した。
// 除外は**案件が宣言する**（.ichiki.json の `not_mockup`）。

const fs = require('fs');
const path = require('path');

// 既定の除外。docs は testspec / release / diff の出力先、scripts は旧テストツールの置き場所。
const DEFAULT_NOT_MOCKUP = ['docs', 'scripts'];

function notMockupDirs(rootDir) {
  try {
    const { readConfig } = require('./project-config');
    const { conf } = readConfig(rootDir);
    if (Array.isArray(conf.not_mockup)) return conf.not_mockup;
  } catch {
    /* 設定が無い場所でも動く（fixture など） */
  }
  return DEFAULT_NOT_MOCKUP;
}

function findHtmlFiles(rootDir) {
  // 無いディレクトリを渡されたら、Node の ENOENT スタックではなく理由を出す。
  // 実測: .ichiki.json の mockup が実在しない場所を指していて、
  // fs.readdirSync の生エラーで落ちていた（何が悪いのか分からない画面）。
  if (!fs.existsSync(rootDir)) {
    console.error(`モックのディレクトリがありません: ${rootDir}`);
    console.error('.ichiki.json の mockup が実在する場所を指しているか確認してください。');
    process.exit(2);
  }
  const results = [];
  const excluded = new Set(notMockupDirs(rootDir).map((d) => path.resolve(rootDir, d)));

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        if (entry.name.startsWith('.')) continue;
        if (excluded.has(abs)) continue;
        walk(abs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        results.push(abs);
      }
    }
  }

  walk(rootDir);
  results.sort();
  return results.map((abs) => ({ abs, rel: path.relative(rootDir, abs).split(path.sep).join('/') }));
}

module.exports = { findHtmlFiles, DEFAULT_NOT_MOCKUP };
