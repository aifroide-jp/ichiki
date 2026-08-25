#!/usr/bin/env node
'use strict';

// proposal/vocabulary.md 9.1 節の実行機構。
// モック配下の全 *.html に pa11y（axe-core ランナー・WCAG2AA）をかけ、
// error が1件でもあれば非ゼロ終了するゲート。
//
// 「モック生成プロンプトに『WCAG2AA を通す前提』と書くだけ」では守られない
// ことが実測（axe-core違反31件・うち色コントラスト30件）で判明したため、
// このスクリプトが唯一の担保になる。CI・pre-commit等から呼び出すこと。
//
// 使い方:
//   node src/a11y/check.js [mockupDir]           人が読める出力
//   node src/a11y/check.js [mockupDir] --json    JSON出力（機械可読）
//
// pa11y は本体の依存（package.json）。素の require で解決する。

const fs = require('fs');
const path = require('path');

let pa11y;
try {
  pa11y = require('pa11y');
} catch (err) {
  console.error('pa11y モジュールが見つかりません。.claude/ichiki で npm install してください');
  console.error('scripts/test-spec で `npm install` 済みか確認してください。');
  console.error(err.message);
  process.exit(2);
}

// --- 既知の除外ルール（これ以外は増やさないこと） ---------------------------
// frame-tested:
//   地図表示に使っている <iframe src="https://maps.google.com/..."> は、
//   モックを file:// で開くと iframe の中身が cross-origin になり、
//   axe-core が「iframe 内部に axe-core のスクリプトを注入して検査できたか」
//   を確認できない（＝frame-tested ルール）。これは file:// 実行時特有の
//   偽陽性で、本番サイト（同一オリジン配信・http/https）では発生しない。
//   このルールだけを既知除外とし、除外した件数は必ず出力に表示する
//   （黙って消さない）。これ以外のルールを「直すのが面倒だから」という
//   理由で追加してはならない。
const KNOWN_EXCLUDED_RULES = new Set(['frame-tested']);

function findHtmlFiles(rootDir) {
  const results = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(abs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        results.push(abs);
      }
    }
  }
  walk(rootDir);
  results.sort();
  return results;
}

async function checkPage(absPathOrUrl) {
  // モックは file://、公開後のサイトは http(s):// で開く。
  // 同じ判定器を使うので、モックと実サイトの結果を並べて比べられる。
  const url = /^https?:\/\//.test(absPathOrUrl) ? absPathOrUrl : 'file://' + absPathOrUrl;
  return pa11y(url, {
    standard: 'WCAG2AA',
    runners: ['axe'],
    // pa11y の既定は levelCapWhenNeedsReview: 'error'。つまり axe の
    // incomplete（=「判定できなかった。人が確認せよ」）が error に格上げされる。
    // これを既定のままにすると「測定不能」と「基準違反」が区別できず、
    // 検査ツールの都合で合意済みのデザインを変える圧力が生まれる
    // （実際に起きた: 写真の上の白文字が color-contrast の incomplete になり、
    //   デザインを単色パネルに変える"修正"が入った）。
    // incomplete は warning に落とし、人手確認項目として別枠で数える。
    levelCapWhenNeedsReview: 'warning',
    // pa11y の既定は includeWarnings: false。上で incomplete を warning へ落としたので、
    // これを既定のままにすると「判定できなかった項目」が結果から丸ごと消える。
    // 消すのではなく人手確認項目として出すのが目的なので必ず true にする。
    includeWarnings: true,
    timeout: 30000,
    chromeLaunchConfig: {
      args: ['--allow-file-access-from-files', '--no-sandbox'],
    },
  });
}

function formatIssue(issue) {
  return {
    rule: issue.code,
    selector: issue.selector,
    context: issue.context,
    message: issue.message,
  };
}

function printHuman(pages, totals) {
  for (const page of pages) {
    console.log(`=== ${page.file} ===`);
    if (page.errors.length === 0 && page.excluded.length === 0 && page.review.length === 0) {
      console.log('  違反なし');
    }
    for (const issue of page.errors) {
      console.log(`  [error] ${issue.rule}`);
      console.log(`    selector: ${issue.selector}`);
      console.log(`    context : ${issue.context}`);
      console.log(`    message : ${issue.message}`);
    }
    if (page.excluded.length > 0) {
      console.log(
        `  [excluded] frame-tested x${page.excluded.length}件（既知の偽陽性。理由はこのファイル冒頭のコメント参照）`
      );
      for (const issue of page.excluded) {
        console.log(`    selector: ${issue.selector}`);
      }
    }
    if (page.review.length > 0) {
      console.log(`  [要人手確認] ${page.review.length}件（axe が判定不能=incomplete と返した項目）`);
      for (const issue of page.review) {
        console.log(`    ${issue.rule}  selector: ${issue.selector}`);
      }
    }
    console.log('');
  }
  console.log('--- summary ---');
  console.log(`pages scanned                 : ${pages.length}`);
  console.log(`errors (AA違反・ビルドを落とす)   : ${totals.error}`);
  console.log(`要人手確認 (axe が判定不能)       : ${totals.review}`);
  console.log(`excluded (frame-tested, 既知の偽陽性): ${totals.excluded}`);
  console.log(totals.error > 0 ? 'RESULT: FAIL' : 'RESULT: PASS');
  if (totals.review > 0) {
    console.log(
      '注意: 要人手確認の件数はゼロではない。自動チェックが「問題なし」と言ったわけではなく、' +
        '「測れなかった」だけである。写真の上の文字などは実際の描画で目視確認すること。'
    );
  }
}

// 公開後のサイトの URL 一覧。verify:live / diff と同じ shared/site-urls.js を使う。
async function liveTargets(mockupDir, siteUrl) {
  const cheerio = require('cheerio');
  const { expandUrls } = require('../shared/site-urls');
  const pages = [];
  for (const f of findHtmlFiles(mockupDir)) {
    const $ = cheerio.load(fs.readFileSync(f, 'utf8'));
    const b = $('body');
    if (!b.attr('data-page')) continue;
    pages.push({
      rel: path.relative(mockupDir, f).split(path.sep).join('/'),
      kind: b.attr('data-page'),
      cpt: b.attr('data-cpt') || null,
      pageId: b.attr('data-page-id') || null,
      variant: b.attr('data-page-variant') || null,
    });
  }
  const getJson = (u) =>
    new Promise((resolve) => {
      const mod = u.startsWith('https') ? require('https') : require('http');
      mod
        .get(u, (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
        })
        .on('error', () => resolve(null));
    });
  const t = await expandUrls(pages, siteUrl, getJson, (kind, msg) => console.error(`  [skip] ${msg}`));
  return t.map((x) => ({ label: x.url, target: siteUrl + x.url }));
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const targetArg = args.find((a) => !a.startsWith('--'));
  // 既定は案件の設定から（本体に 'mockup' というディレクトリは無い）
  const { readConfig } = require('../shared/project-config');
  const mockupDir = path.resolve(process.cwd(), targetArg || readConfig(process.cwd()).conf.mockup || './');

  if (!fs.existsSync(mockupDir)) {
    console.error(`対象ディレクトリが見つかりません: ${mockupDir}`);
    process.exit(2);
  }

  // --site <URL>: モックではなく**公開後のサイト**を検査する。
  // 検収（C1）は実サイトの結果を要求する。CF7 のマークアップのように
  // 変換後にしか現れない要素があるので、モックの結果では代用できない。
  // URL の一覧は verify:live と同じ関数で導く（手書きの一覧を持たない）。
  const siteIdx = args.indexOf('--site');
  const siteUrl = siteIdx >= 0 ? args[siteIdx + 1] : null;

  let targets;
  if (siteUrl) {
    targets = await liveTargets(mockupDir, siteUrl.replace(/\/$/, ''));
    if (!targets.length) {
      console.error(`検査対象の URL を導けません: ${siteUrl}`);
      process.exit(2);
    }
  } else {
    const files = findHtmlFiles(mockupDir);
    if (files.length === 0) {
      console.error(`*.html が見つかりません: ${mockupDir}`);
      process.exit(2);
    }
    targets = files.map((f) => ({ label: path.relative(mockupDir, f).split(path.sep).join('/'), target: f }));
  }

  const pages = [];
  let totalErrors = 0;
  let totalExcluded = 0;
  let totalReview = 0;

  for (const t of targets) {
    const rel = t.label;
    let results;
    try {
      results = await checkPage(t.target);
    } catch (err) {
      console.error(`実行エラー: ${rel}: ${err.message}`);
      process.exit(2);
    }

    const allErrorIssues = results.issues.filter((i) => i.type === 'error');
    const excluded = allErrorIssues.filter((i) => KNOWN_EXCLUDED_RULES.has(i.code));
    const counted = allErrorIssues.filter((i) => !KNOWN_EXCLUDED_RULES.has(i.code));

    // axe が incomplete と返した項目（= 判定不能・要人手確認）。
    // ビルドは落とさないが、件数と内訳を必ず出す。ここを表示しないと
    // 「測定できていない」ことが「問題なし」と区別できなくなる。
    const review = results.issues.filter(
      (i) => i.type === 'warning' && !KNOWN_EXCLUDED_RULES.has(i.code)
    );

    totalErrors += counted.length;
    totalExcluded += excluded.length;
    totalReview += review.length;

    pages.push({
      file: rel,
      url: t.target,
      errors: counted.map(formatIssue),
      excluded: excluded.map(formatIssue),
      review: review.map(formatIssue),
    });
  }

  const totals = { error: totalErrors, excluded: totalExcluded, review: totalReview };

  // --site のときは、検収（C1）が読める形でも書き出す。
  // testspec は pa11y-ci の形式 { results: { <url>: issue[] } } を期待する。
  // pa11y-ci を別途入れずに済ませたいので、同じ判定器の結果をその形で出す
  // （判定器を2つ持つと結果が割れる。実測でそれを何度も踏んでいる）。
  if (siteUrl) {
    const ri = args.indexOf('--report');
    const reportPath = path.resolve(process.cwd(), ri >= 0 ? args[ri + 1] : 'pa11y-report.json');
    const results = {};
    // 除外ルール（既知の偽陽性）は数に入れない。人が見る数字と揃える。
    // **code を必ず持たせる。** 読み手は「code を持たない要素＝接続失敗」と判定するので、
    // 落とすと全ページが「サイトに繋がらなかった」と誤読される（実測で踏んだ）。
    for (const pg of pages) {
      results[pg.url || pg.file] = pg.errors.map((e) => ({
        code: e.rule,
        selector: e.selector,
        context: e.context,
        message: e.message,
      }));
    }
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ total: pages.length, errors: totalErrors, results }, null, 2),
      'utf8'
    );
    if (!jsonMode) console.log(`検収向けレポート: ${path.relative(process.cwd(), reportPath)}`);
  }

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          standard: 'WCAG2AA',
          runner: 'axe',
          mockupDir,
          knownExcludedRules: [...KNOWN_EXCLUDED_RULES],
          pages,
          totals,
        },
        null,
        2
      )
    );
  } else {
    printHuman(pages, totals);
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
