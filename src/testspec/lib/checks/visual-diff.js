'use strict';
// `ichiki diff` が出したレポートを「読むだけ」。未実行なら常に null（再実行はしない）。
//
// パスは案件側にあるので引数で受け取る。かつては本体からの相対で
// scripts/visual-diff/{pages.js, report/index.html} を直接指していたが、
// 移設でその場所が消え、**存在しないファイルを読もうとしていた**（常に縮退していた）。
// 縮退が安全側なので気づけなかった。
const fs = require('fs');
const path = require('path');

// diff が出す results.json を「読むだけ」。未実行なら常に null（再実行はしない）。
//
// 以前は index.html を正規表現で読んでいた。**表示を直したら壊れる。**
// 実測: 見出しを日本語にしただけで viewport の照合が効かなくなった。
// 人が見るもの（HTML）と機械が読むもの（JSON）を分ける。

// pagesPath : diff が出した対応表（<出力先>/pages.json）
// jsonPath  : diff が出した結果（<出力先>/results.json）
function readVisualDiffReport(pagesPath, jsonPath) {
  if (!pagesPath || !jsonPath || !fs.existsSync(pagesPath) || !fs.existsSync(jsonPath)) {
    return { getResult: () => null };
  }

  const pagesList = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
  const labelByMockup = new Map(pagesList.map((p) => [p.mockup, p.label]));

  const pctByLabelViewport = new Map();
  for (const r of JSON.parse(fs.readFileSync(jsonPath, 'utf8'))) {
    if (r.pct != null) pctByLabelViewport.set(`${r.label}__${r.viewport}`, String(r.pct));
  }

  return {
    getResult(file) {
      const label = labelByMockup.get(file);
      if (!label) return null;
      const desktopPct = pctByLabelViewport.get(`${label}__desktop`) || null;
      const mobilePct = pctByLabelViewport.get(`${label}__mobile`) || null;
      if (desktopPct == null && mobilePct == null) return null;
      return { desktopPct, mobilePct };
    },
  };
}

module.exports = { readVisualDiffReport };
