'use strict';
// `ichiki diff` が出したレポートを「読むだけ」。未実行なら常に null（再実行はしない）。
//
// パスは案件側にあるので引数で受け取る。かつては本体からの相対で
// scripts/visual-diff/{pages.js, report/index.html} を直接指していたが、
// 移設でその場所が消え、**存在しないファイルを読もうとしていた**（常に縮退していた）。
// 縮退が安全側なので気づけなかった。
const fs = require('fs');
const path = require('path');

// buildReport() (src/visual/diff.js) が出す <tr><td>label</td><td>viewport</td><td>...NN.NN%...</td> の形を読む
const ROW_RE = /<tr>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>(?:<span[^>]*>([\d.]+)%<\/span>|<span[^>]*>skip<\/span>)<\/td>/g;

// pagesPath : 比較対象の一覧（案件側の JSON。[{ label, mockup, wp }, …]）
// reportPath: diff の出力（<出力先>/index.html）
function readVisualDiffReport(pagesPath, reportPath) {
  if (!pagesPath || !reportPath || !fs.existsSync(pagesPath) || !fs.existsSync(reportPath)) {
    return { getResult: () => null };
  }

  const pagesList = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
  const labelByMockup = new Map(pagesList.map((p) => [p.mockup, p.label]));

  const html = fs.readFileSync(reportPath, 'utf8');
  const pctByLabelViewport = new Map();
  let m;
  while ((m = ROW_RE.exec(html))) {
    const [, label, viewport, pct] = m;
    if (pct) pctByLabelViewport.set(`${label}__${viewport}`, pct);
  }

  return {
    getResult(file) {
      const label = labelByMockup.get(file);
      if (!label) return null;
      const desktopPct = pctByLabelViewport.get(`${label}__desktop`) || null;
      const mobilePct = pctByLabelViewport.get(`${label}__mobile`) || null;
      if (desktopPct === null && mobilePct === null) return null;
      return { desktopPct, mobilePct };
    },
  };
}

module.exports = { readVisualDiffReport };
