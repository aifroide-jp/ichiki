'use strict';

// vocabulary.md 7章の固定パス規約(css/base.css・css/page/<id or cpt>.css・js/main.js)を
// 一箇所にまとめる。gen/functions.js（enqueue の生成）と scan（ビルド前の早期検査）の
// 両方がここを使う。同じ規約を2箇所に書くと、変わったときに片方だけ直り忘れて食い違う
// （rules/ichiki.md と vocabulary.md を分けた理由と同じ）。

function cssBasePath() {
  return 'css/base.css';
}
function cssPagePath(idOrCpt) {
  return `css/page/${idOrCpt}.css`;
}
function jsMainPath() {
  return 'js/main.js';
}
// js/page/<id or cpt>.js は「あれば読む」任意ファイル(build 側も model.pageJs で
// 実在するものだけを対象にする)。無くてもテーマは壊れないので requiredAssetPaths には含めない。
function jsPagePath(idOrCpt) {
  return `js/page/${idOrCpt}.js`;
}

// build に要る(無いとテーマが壊れる) css/js の一覧。model から機械的に求まる。
function requiredAssetPaths(model) {
  const css = [cssBasePath()];
  if (model.front) css.push(cssPagePath('front'));
  for (const pageId of model.pageMap.keys()) css.push(cssPagePath(pageId));
  for (const cpt of model.cptMap.keys()) css.push(cssPagePath(cpt));
  return { css, js: [jsMainPath()] };
}

module.exports = { cssBasePath, cssPagePath, jsMainPath, jsPagePath, requiredAssetPaths };
