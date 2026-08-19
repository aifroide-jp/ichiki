'use strict';
// scripts/visual-diff/ の既存レポートを「読むだけ」。未実行なら常に null（再実行はしない）。
const fs = require('fs');
const path = require('path');

const PAGES_PATH = path.join(__dirname, '..', '..', '..', 'visual-diff', 'pages.js');
const REPORT_PATH = path.join(__dirname, '..', '..', '..', 'visual-diff', 'report', 'index.html');

// buildReport() (scripts/visual-diff/diff.js) が出す <tr><td>label</td><td>viewport</td><td>...NN.NN%...</td> の形を読む
const ROW_RE = /<tr>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>(?:<span[^>]*>([\d.]+)%<\/span>|<span[^>]*>skip<\/span>)<\/td>/g;

function readVisualDiffReport() {
  if (!fs.existsSync(PAGES_PATH) || !fs.existsSync(REPORT_PATH)) {
    return { getResult: () => null };
  }

  const pagesList = require(PAGES_PATH);
  const labelByMockup = new Map(pagesList.map(p => [p.mockup, p.label]));

  const html = fs.readFileSync(REPORT_PATH, 'utf8');
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
