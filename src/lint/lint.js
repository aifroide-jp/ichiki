#!/usr/bin/env node
'use strict';

// rules/vocabulary.md L01-L21 lint
// 使い方: node src/lint/lint.js <対象ディレクトリ> [--json] [--allow-unresolved-links]
//
// --allow-unresolved-links:
//   一時的なエスケープハッチ。変換器の同名オプションと同じ事実（モックがまだ全ページ
//   揃っていない）を扱う。L30 の「行き先がモックにありません」だけを警告に落とす。
//   「モックの外を指しています」は書き間違いであり、落とさない。

const path = require('path');
const { findHtmlFiles } = require('./lib/discover');
const { loadPage } = require('./lib/parse-page');
const { runPerPageRules, runCrossPageRules } = require('./rules');

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const allowUnresolved = args.includes('--allow-unresolved-links');
  const targetArg = args.find((a) => !a.startsWith('--'));

  if (!targetArg) {
    console.error('Usage: node src/lint/lint.js <対象ディレクトリ> [--json] [--allow-unresolved-links]');
    process.exit(2);
  }

  const rootDir = path.resolve(process.cwd(), targetArg);
  const files = findHtmlFiles(rootDir);
  const pages = files.map((f) => loadPage(f.abs, f.rel));

  let issues = [];
  for (const page of pages) {
    issues = issues.concat(runPerPageRules(page, rootDir));
  }
  issues = issues.concat(runCrossPageRules(pages, rootDir));

  if (allowUnresolved) {
    for (const issue of issues) {
      if (issue.unresolvedLink) issue.severity = 'warn';
    }
  }

  issues.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    const al = a.line == null ? Infinity : a.line;
    const bl = b.line == null ? Infinity : b.line;
    if (al !== bl) return al - bl;
    return a.rule.localeCompare(b.rule);
  });

  const summary = {};
  for (const issue of issues) {
    if (!summary[issue.rule]) summary[issue.rule] = { error: 0, warn: 0 };
    summary[issue.rule][issue.severity] += 1;
  }

  const totalErrors = issues.filter((i) => i.severity === 'error').length;
  const totalWarns = issues.filter((i) => i.severity === 'warn').length;

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          root: rootDir,
          fileCount: pages.length,
          issues,
          summary,
          totals: { error: totalErrors, warn: totalWarns },
        },
        null,
        2
      )
    );
  } else {
    for (const issue of issues) {
      const loc = issue.line != null ? `${issue.file}:${issue.line}` : issue.file;
      console.log(`${loc}\t${issue.rule}\t${issue.severity}\t${issue.message}`);
    }
    console.log('');
    console.log(`--- summary (${pages.length} files scanned) ---`);
    const ruleIds = Object.keys(summary).sort();
    for (const id of ruleIds) {
      const s = summary[id];
      console.log(`${id}: error=${s.error} warn=${s.warn}`);
    }
    console.log(`total: error=${totalErrors} warn=${totalWarns}`);
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
