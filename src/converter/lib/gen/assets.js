'use strict';

const fs = require('fs');
const path = require('path');

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

// css/ と js/ と images/ を assets/ 配下へコピーする(vocabulary.md 10章)。
// images/meta.yaml は lint 専用のメタ情報であり配信物ではないため除外する。
//
// js/ が漏れていた（実測）。data-* を残す修正を入れても、**それを読む js/main.js が
// テーマに入っていなければ意味がない**。生成テーマの .js は0件で、ハンバーガー・
// ドロップダウン・イベント絞り込みが黙って動かない状態だった。
function copyAssets(mockupDir, outDir, errors) {
  const cssSrc = path.join(mockupDir, 'css');
  const jsSrc = path.join(mockupDir, 'js');
  const imagesSrc = path.join(mockupDir, 'images');

  if (!fs.existsSync(cssSrc)) {
    errors.add('(assets)', null, 'css/ ディレクトリが見つかりません');
  } else {
    copyDirRecursive(cssSrc, path.join(outDir, 'assets', 'css'));
  }

  if (!fs.existsSync(jsSrc)) {
    errors.add('(assets)', null, 'js/ ディレクトリが見つかりません');
  } else {
    copyDirRecursive(jsSrc, path.join(outDir, 'assets', 'js'));
  }

  // ルート直下の単体アセット（favicon 等）。<head> の <link> が参照するので、
  // 拾わないと WordPress 側で 404 になる（実測: favicon.svg が丸ごと落ちていた）。
  for (const name of fs.readdirSync(mockupDir)) {
    if (!/^favicon\./i.test(name)) continue;
    const src = path.join(mockupDir, name);
    if (!fs.statSync(src).isFile()) continue;
    fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
    fs.copyFileSync(src, path.join(outDir, 'assets', name));
  }

  if (!fs.existsSync(imagesSrc)) {
    errors.add('(assets)', null, 'images/ ディレクトリが見つかりません');
  } else {
    copyDirRecursive(imagesSrc, path.join(outDir, 'assets', 'images'));
    const metaPath = path.join(outDir, 'assets', 'images', 'meta.yaml');
    if (fs.existsSync(metaPath)) fs.rmSync(metaPath);
  }
}

module.exports = { copyAssets };
