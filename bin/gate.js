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
function collectCptBaseNames(dir) {
  const bases = new Set();
  if (!fs.existsSync(dir)) return bases;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^single-([a-zA-Z0-9]+[_-])?([a-zA-Z0-9_-]+)\.php$/);
    if (m) {
      bases.add(m[2]);
    }
  }
  return bases;
}

function getBaseCptName(file, cptBases) {
  if (!file) return null;
  const parts = file.split('/');
  if (parts.length < 2) return null; // about/index.html などの第一階層は固定ページ扱い

  // ディレクトリ階層をチェックし、テーマに存在するCPTベース名と一致するものを探す
  for (let i = parts.length - 2; i >= 0; i--) {
    let dirName = parts[i];
    if (dirName === 'cases') dirName = 'case';
    const cleanName = (dirName === 'news') ? 'news' : dirName.replace(/s$/, '');
    if (cptBases.has(cleanName)) {
      return cleanName;
    }
  }
  return null;
}

function hasCptTemplate(dir, type, baseName) {
  if (!fs.existsSync(dir)) return false;
  const files = fs.readdirSync(dir);
  const re = new RegExp(`^${type}-([a-zA-Z0-9]+[_-])?${baseName}\\.php$`);
  return files.some(f => re.test(f));
}

function hasCptAcf(dir, baseName) {
  const incDir = path.join(dir, 'inc');
  if (!fs.existsSync(incDir)) return false;
  const files = fs.readdirSync(incDir);
  const re = new RegExp(`^acf-([a-zA-Z0-9]+[_-])?${baseName}\\.php$`);
  return files.some(f => re.test(f));
}

function checkStructure(opts) {
  const map = loadAcfMap(opts.acfMap);
  if (!opts.themeDir) die('--theme-dir が必要です');
  if (!fs.existsSync(opts.themeDir)) die(`theme-dir が見つかりません: ${opts.themeDir}`);
  const dir = opts.themeDir;
  const has = rel => fs.existsSync(path.join(dir, rel));
  const problems = [];
  
  // テーマフォルダ内のファイルから実在するCPTベース名を逆引き収集
  const cptBases = collectCptBaseNames(dir);

  // 各ページ: page-<slug-hyphen>.php または single-<cpt>.php、および inc/acf-pages.php などの検証
  for (const p of map.pages || []) {
    const slug = p.id.replace(/_/g, '-'); // 検証時はアンダースコアをハイフンに正規化
    const file = p.file || '';
    const cptBase = getBaseCptName(file, cptBases);
    const isIndex = file.endsWith('index.html');

    // 1. テンプレートファイルのチェック
    if (cptBase && !isIndex) {
      // CPTの詳細ページの場合：共通の single テンプレートがあれば合格とする（プレフィックス対応）
      if (!hasCptTemplate(dir, 'single', cptBase)) {
        problems.push(`CPT詳細テンプレ欠落: single-*[_-]${cptBase}.php (対象: ${p.id})`);
      }
    } else {
      // 固定ページまたは一覧ページの場合：個別テンプレート（ハイフン表記でチェック）
      const hasIndividual = has(`page-${slug}.php`) || has(`single-${slug}.php`);

      // CPTの一覧ページ（index.html）の場合：共通の archive テンプレートがあれば合格とする
      const hasArchive = cptBase && isIndex && hasCptTemplate(dir, 'archive', cptBase);

      // トップページの場合：front-page.php があれば合格とする
      const isTopPage = slug === 'index' || slug === 'home' || slug === 'top';
      const hasFrontPage = isTopPage && has('front-page.php');

      if (!hasIndividual && !hasArchive && !hasFrontPage) {
        problems.push(`テンプレ欠落: page-${slug}.php または single-${slug}.php`);
      }
    }

    // 2. ACF定義ファイルのチェック
    if (cptBase) {
      // CPTページの場合：個別acfファイル、またはCPT用の統合acfファイルを許容
      const hasIndividualAcf = has(`inc/acf-${slug}.php`);
      const hasConsolidatedAcf = hasCptAcf(dir, cptBase);
      if (!hasIndividualAcf && !hasConsolidatedAcf) {
        problems.push(`ACF定義欠落: inc/acf-${slug}.php または CPT統合定義 inc/acf-*[_-]${cptBase}.php`);
      }
    } else {
      // 固定ページの場合：個別acfファイル、または固定ページ用の統合acfファイル (acf-pages.php) を許容
      const hasIndividualAcf = has(`inc/acf-${slug}.php`);
      const hasPagesAcf = has('inc/acf-pages.php') || hasCptAcf(dir, 'pages'); // acf-pages.php (プレフィックス対応含む)
      if (!hasIndividualAcf && !hasPagesAcf) {
        problems.push(`ACF定義欠落: inc/acf-${slug}.php または統合定義 inc/acf-pages.php`);
      }
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
