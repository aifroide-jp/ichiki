'use strict';
// pa11y-ci の実行結果（JSON）を読む。未実行（ファイル無し）は null を返し、
// それを「NG」や「0件」と偽装しないこと。
const fs = require('fs');

function readA11yReport(reportPath) {
  if (!fs.existsSync(reportPath)) return null;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (e) {
    return null;
  }

  // pa11y-ci の実際の形式: { total, passes, errors, results: { [pageUrl]: issues[] } }
  // pa11y-ci はURL接続失敗時も同じ results[url] に catch したエラーを1件だけ積む
  // （lib/pa11y-ci.js: `report.results[url] = [error]`）。本物のissueは必ず code を持つので、
  // code を持たないエントリが1件でも混ざっていたら「違反」ではなく「接続失敗」と判断して落とす。
  const map = new Map();
  const results = (raw && raw.results) || {};
  for (const [url, issues] of Object.entries(results)) {
    if (!Array.isArray(issues)) continue;
    const connectionFailure = issues.find(issue => issue && !('code' in issue));
    if (connectionFailure) {
      throw new Error(
        `pa11y-ci: ${url} への接続に失敗した（${connectionFailure.message}）。` +
        'Localサイトが起動しているか、.ichiki.json の site_url が正しいか確認してから再実行すること。'
      );
    }
    map.set(url, { violations: issues.length });
  }

  return map;
}

module.exports = { readA11yReport };
