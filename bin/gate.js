#!/usr/bin/env node
'use strict';
// Ichiki Phase 1 検収ゲート。acf-map.yaml と Claude Code の出力を突き合わせる。
//   node bin/gate.js check-coverage  --acf-map <acf-map.yaml> --field-map <field-map.json>
//   node bin/gate.js check-structure --acf-map <acf-map.yaml> --theme-dir <theme-dir>
//   node bin/gate.js check-all       --acf-map <acf-map.yaml> --field-map <field-map.json> --theme-dir <theme-dir>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--acf-map') opts.acfMap = args[++i];
    else if (args[i] === '--field-map') opts.fieldMap = args[++i];
    else if (args[i] === '--theme-dir') opts.themeDir = args[++i];
  }
  return opts;
}

function loadAcfMap(file) {
  if (!file) die('--acf-map が必要です');
  if (!fs.existsSync(file)) die(`acf-map が見つかりません: ${file}`);
  return yaml.load(fs.readFileSync(file, 'utf8')) || {};
}

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}

// acf-map.yaml の全 field_name を収集する（pages 内 ＋ common 内）
function collectFieldNames(map) {
  const names = [];
  const fromSections = sections => {
    for (const sec of sections || []) for (const f of sec.fields || []) {
      if (f.field_name) names.push(f.field_name);
    }
  };
  fromSections(map.common);
  for (const p of map.pages || []) fromSections(p.sections);
  return names;
}

// 出力契約のファイルを再帰収集する（php -l 用）
function listPhpFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listPhpFiles(full));
    else if (/\.php$/i.test(e.name)) out.push(full);
  }
  return out;
}

// ---- check-coverage (B3) --------------------------------------------------
function checkCoverage(opts) {
  const map = loadAcfMap(opts.acfMap);
  if (!opts.fieldMap) die('--field-map が必要です');
  if (!fs.existsSync(opts.fieldMap)) die(`field-map が見つかりません: ${opts.fieldMap}`);
  const fieldMap = JSON.parse(fs.readFileSync(opts.fieldMap, 'utf8'));
  const sources = new Set((fieldMap.mappings || []).map(m => m.source));

  const fieldNames = collectFieldNames(map);
  const missing = fieldNames.filter(n => !sources.has(n));

  if (missing.length === 0) {
    console.log(`PASS check-coverage: ${fieldNames.length} フィールドすべてが field-map に対応`);
    return true;
  }
  console.log(`FAIL check-coverage: ${missing.length}/${fieldNames.length} フィールドが field-map に未対応`);
  for (const n of missing) console.log(`  - 欠落: ${n}`);
  return false;
}

// ---- check-structure (B4) -------------------------------------------------
function checkStructure(opts) {
  const map = loadAcfMap(opts.acfMap);
  if (!opts.themeDir) die('--theme-dir が必要です');
  if (!fs.existsSync(opts.themeDir)) die(`theme-dir が見つかりません: ${opts.themeDir}`);
  const dir = opts.themeDir;
  const has = rel => fs.existsSync(path.join(dir, rel));
  const problems = [];

  // 各ページ: page-<slug>.php または single-<cpt>.php、および inc/acf-<slug>.php
  for (const p of map.pages || []) {
    const slug = p.id;
    if (!has(`page-${slug}.php`) && !has(`single-${slug}.php`)) {
      problems.push(`テンプレ欠落: page-${slug}.php または single-${slug}.php`);
    }
    if (!has(`inc/acf-${slug}.php`)) {
      problems.push(`ACF定義欠落: inc/acf-${slug}.php`);
    }
  }

  // 必須の共通ファイル
  for (const req of ['functions.php', 'header.php', 'footer.php', 'front-page.php']) {
    if (!has(req)) problems.push(`必須ファイル欠落: ${req}`);
  }

  // php -l による syntax チェック（php が無い環境ではスキップして明示する）
  const phpFiles = listPhpFiles(dir);
  let lintSkipped = false;
  for (const file of phpFiles) {
    try {
      execFileSync('php', ['-l', file], { stdio: 'pipe' });
    } catch (e) {
      if (e.code === 'ENOENT') { lintSkipped = true; break; }
      const detail = (e.stderr || e.stdout || '').toString().trim().split('\n')[0] || 'syntax error';
      problems.push(`php -l エラー: ${path.relative(dir, file)} — ${detail}`);
    }
  }
  if (lintSkipped) console.log('  note: php が見つからないため php -l はスキップしました');

  if (problems.length === 0) {
    console.log(`PASS check-structure: 出力契約のファイルが揃い、php -l も通過`);
    return true;
  }
  console.log(`FAIL check-structure: ${problems.length} 件の問題`);
  for (const p of problems) console.log(`  - ${p}`);
  return false;
}

// ---- check-all ------------------------------------------------------------
function checkAll(opts) {
  const cov = checkCoverage(opts);
  const str = checkStructure(opts);
  return cov && str;
}

const cmd = process.argv[2];
const opts = parseArgs(process.argv.slice(3));
let ok;
if (cmd === 'check-coverage') ok = checkCoverage(opts);
else if (cmd === 'check-structure') ok = checkStructure(opts);
else if (cmd === 'check-all') ok = checkAll(opts);
else {
  console.error(`unknown command: ${cmd || '(none)'}
commands:
  check-coverage  --acf-map <acf-map.yaml> --field-map <field-map.json>
  check-structure --acf-map <acf-map.yaml> --theme-dir <theme-dir>
  check-all       --acf-map <acf-map.yaml> --field-map <field-map.json> --theme-dir <theme-dir>`);
  process.exit(2);
}
process.exit(ok ? 0 : 1);
