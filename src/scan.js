#!/usr/bin/env node
'use strict';

// モックアップ（制約語彙 rules/vocabulary.md 準拠）から
//   - acf-map.yaml   （フィールド台帳。人が読む・お客様と合意する）
//   - coverage.json  （テキスト取りこぼしゼロの証明）
//   - CLAUDE.md      （案件用。templates/CLAUDE.md.tmpl から）
// を生成する。
//
// **モックの読み取りは変換器（src/converter）の実装をそのまま呼ぶ。**
//   以前は scan が独自にモックを読んでいた。同じ HTML を2つの実装が読むので、
//   実測で39件の食い違いが出た（整形タグを落とす／入れ子フィールドの文字を飲み込む／
//   data-loop-sample を除外しない／改行をまたぐ属性が読めない）。すべて scan 側の誤り。
//   台帳が実際に生成される値とズレていれば、お客様と合意した内容が嘘になる。
//   したがって scan は「変換器のモデルを YAML に書き出すだけ」にする。
//
// 取りこぼしゼロの定義（coverage.json で検証する等式）:
//   全テキストノード
//     = ACF化(data-acf)
//     + 別機構で編集(data-nav = WPメニュー / data-cf7 = CF7 / data-breadcrumb)
//     + 変換時に破棄(data-loop-sample)
//     + 装飾(data-deco / aria-hidden / svg)
//     + 未宣言（＝暗黙の固定文言。お客様と「更新対象外」の合意が要る分）
//   右辺の合計が左辺と一致すること。分類できないテキストが1件もないこと。
//
// 分類そのものは src/shared/text-classify.js が唯一の実装で、lint L20 と共有する。

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { BUCKETS, classifyPage } = require('./shared/text-classify');
const { navsOf, formsOf, decorationOf, metaOf, cssOf } = require('./shared/page-facts');
const { findHtmlFiles } = require('./converter/lib/discover');
const { loadPage } = require('./converter/lib/load-page');
const { ErrorCollector } = require('./converter/lib/errors');
const { buildModel, collectFieldsIn } = require('./converter/lib/model');
const { readConfig, writeConfig, FILENAME } = require('./shared/project-config');
const { DEFAULT_SEPARATOR, deriveTitleSuffix } = require('./shared/site-title');

function pageIdFromFile(rel) {
  let id = rel.replace(/\.html$/i, '');
  id = id.replace(/(^|\/)index$/i, '$1').replace(/\/$/, '');
  if (id === '') id = 'index';
  return id.replace(/[\/\-]/g, '_');
}

// 変換器のフィールド（{name,type,defaultValue,asset,alt}）を台帳の行にする。
// element と tab は落とす。element はタグ名で、型を決めた後は誰も使わない。
// tab は常に "section" で、実際のタブ分けは data-section から変換器が作る（gen/acf.js）。
function ledgerRow(f) {
  const row = { field_name: f.name, type: f.type };
  if (f.type === 'image') {
    // 画像は assets/ 配下に置かれる位置（モックルート基準に正規化済み）。
    row.default = f.asset || '';
    if (f.alt) row.alt = f.alt;
  } else {
    row.default = f.defaultValue == null ? '' : f.defaultValue;
  }
  return row;
}

function classifyTexts($, file) {
  const { total, counts, unclaimed } = classifyPage($('body').get(0));
  return { file, total, counts, unclaimed };
}

function ledgerPage(page, model, errors) {
  const $ = page.$;
  const out = {
    id: pageIdFromFile(page.relPath),
    title: page.title,
    file: page.relPath,
    page_type: page.dataPage,
  };
  if (page.cpt) out.cpt = page.cpt;
  if (page.pageId) out.page_id = page.pageId;
  if (page.variant) out.variant = page.variant;

  out.css = cssOf($, page.relPath, path);

  out.sections = [];
  $('[data-section]').each((_, el) => {
    out.sections.push({
      id: $(el).attr('data-section'),
      fields: collectFieldsIn(page, el, model, errors).map(ledgerRow),
    });
  });

  const loops = [];
  $('[data-loop]').each((_, el) => {
    const $l = $(el);
    const item = $l.children('[data-loop-item]').get(0);
    loops.push({
      cpt: $l.attr('data-loop'),
      order: $l.attr('data-loop-order') || 'date_desc',
      count: parseInt($l.attr('data-loop-count') || '-1', 10),
      // data-loop-repeat: 同じ中身の子を複数持つループの周回数（vocabulary.md 3.1 / L27）
      repeat: parseInt($l.attr('data-loop-repeat') || '1', 10),
      item_fields: item ? collectFieldsIn(page, item, model, errors).map((f) => f.name) : [],
    });
  });
  if (loops.length) out.loops = loops;

  out.nav = navsOf($);
  out.forms = formsOf($);
  out.decoration = decorationOf($);
  out.meta = metaOf($);

  const commons = [];
  $('[data-common]').each((_, el) => {
    commons.push({
      id: $(el).attr('data-common'),
      fields: collectFieldsIn(page, el, model, errors).map(ledgerRow),
    });
  });

  return { page: out, commons, coverage: classifyTexts($, page.relPath) };
}

// 案件用 CLAUDE.md（templates/CLAUDE.md.tmpl から生成）。差し込み口は3つ。
function renderClaudeMd(acfMap, tmplPath) {
  const tmpl = fs.readFileSync(tmplPath, 'utf8');
  const pageLines = (acfMap.pages || []).map((p) => `- ${p.title} (${p.file})`).join('\n');
  return tmpl
    .replace(/\{\{PROJECT\}\}/g, acfMap.project || '')
    .replace(/\{\{GENERATED\}\}/g, new Date().toISOString().slice(0, 10))
    .replace(/\{\{PAGES\}\}/g, pageLines);
}

// モックの <title> から区切り文字を採る。トップは形が違う（サイト名 + 区切り + タグライン）ので外す。
function separatorFromMockup(pages) {
  const entries = [];
  for (const p of pages) {
    const dataPage = p.$('body').attr('data-page');
    if (!dataPage || dataPage === 'front') continue;
    const t = p.title;
    if (t) entries.push({ relPath: p.relPath, title: t });
  }
  if (entries.length < 2) return null;
  const d = deriveTitleSuffix(entries);
  return d.ok ? d.separator : null;
}

// .ichiki.json を用意する。**既にある値は書き換えない。**
// 上書きすると theme_dir / site_url のような環境依存の設定を壊す。
function ensureProjectConfig(confPath, conf, rootDir, projectName, model, titleSeparator) {
  const target = confPath || path.join(process.cwd(), FILENAME);
  const before = JSON.stringify(conf);
  const next = { ...conf };
  const added = [];

  if (!next.project) { next.project = projectName; added.push(`project: ${projectName}`); }
  if (!next.mockup) {
    const rel = path.relative(path.dirname(target), rootDir).split(path.sep).join('/') || '.';
    next.mockup = rel === '.' ? './' : rel;
    added.push(`mockup: ${next.mockup}`);
  }
  if (next.theme_dir === undefined) { next.theme_dir = ''; added.push('theme_dir: （未設定。書いてください）'); }
  if (next.site_url === undefined) { next.site_url = ''; added.push('site_url: （未設定。書いてください）'); }
  if (next.title_separator === undefined) {
    // モックから採った値（採れなければ既定）。**推測ではない。**
    // 全ページが同じ末尾であることが割り出しの前提で、揃っていなければ lint L32 が落とす。
    // 書いたあとも変換のたびに全ページ検査するので、静かにズレることはない。
    next.title_separator = titleSeparator;
    added.push(
      `title_separator: ${JSON.stringify(titleSeparator)}` +
        (titleSeparator === DEFAULT_SEPARATOR ? '' : '（モックの <title> から）')
    );
  }
  if (!next.ichiki_version) {
    try {
      next.ichiki_version = require('../package.json').version;
      added.push(`ichiki_version: ${next.ichiki_version}`);
    } catch { /* package.json が無い配置では飛ばす */ }
  }

  if (JSON.stringify(next) === before) return;
  writeConfig(target, next);
  console.log('');
  console.log(`${confPath ? '更新' : '作成'}: ${path.relative(process.cwd(), target)}`);
  for (const a of added) console.log(`  ${a}`);
  const site = model.siteTitle;
  console.log(`  ※ <title> の区切りは ${JSON.stringify(site.separator)} として扱いました。`);
  console.log(`     サイト名 "${site.siteName}"${site.tagline ? ` / タグライン "${site.tagline}"` : ''}`);
}

function main() {
  const pIdx = process.argv.indexOf('--project');
  const projectName = pIdx >= 0 ? process.argv[pIdx + 1] : null;
  // --allow-unresolved-links: 変換器と同じ意味。モックが未完成でリンク先がまだ無い間、
  // 未解決の内部リンクをエラーではなく警告に落とす。scan も変換器と同じ読み取りを使う以上、
  // 同じ逃げ道が要る（渡さないと台帳が作れず、モック作成中に台帳を見られなくなる）。
  const allowUnresolvedLinks = process.argv.includes('--allow-unresolved-links');
  const args = process.argv
    .slice(2)
    .filter((a, i, all) => a !== '--project' && all[i - 1] !== '--project' && a !== '--allow-unresolved-links');
  const rootDir = path.resolve(process.cwd(), args[0] || path.join(__dirname, '..', 'mockup'));
  const outDir = path.resolve(process.cwd(), args[1] || path.join(__dirname, 'out'));

  const files = findHtmlFiles(rootDir);
  if (!files.length) {
    console.error(`*.html が見つかりません: ${rootDir}`);
    process.exit(2);
  }

  const { path: confPath, conf } = readConfig(rootDir);
  const errors = new ErrorCollector();
  // retrofit 宣言があれば未解決リンクを許す（変換器と同じ規則）
  errors.allowUnresolvedLinks = allowUnresolvedLinks || !!conf.retrofit;
  const loaded = files.map((f) => loadPage(f.abs, f.rel));
  // 区切り文字は設定が正。**無ければモックから採る。**
  // 既定値を機械的に書くと、モックが別の区切りで書かれていた場合に
  // 「変換が止まる → 設定を1行直す → もう一度回す」という無駄な往復が生まれる。
  // 割り出しは lint L32 と同じ関数なので、lint が通ったモックなら必ず一致する。
  const titleSeparator = conf.title_separator || separatorFromMockup(loaded) || DEFAULT_SEPARATOR;
  const model = buildModel(loaded, errors, { titleSeparator });
  errors.throwIfAny();

  const pages = [];
  const coverages = [];
  // data-common は「サイトの共通領域」を指す宣言であって、
  // **全ページが同じ構成を持つことは要求しない**（vocabulary.md 4章）。
  // 申し込みフォームのように、離脱を防ぐためナビも CTA も落とした簡易レイアウトの
  // ページが実在する。変換器はこれを「自前のシェルを持つページ」として扱う。
  // したがって scan も、宣言されている id を**和集合**で集めるだけにする。
  // 同じ id なのに中身が違う場合は lint L09 が全ページ横断で検出する。
  const commonBlocks = new Map();

  for (const page of loaded) {
    const r = ledgerPage(page, model, errors);
    pages.push(r.page);
    coverages.push(r.coverage);
    for (const c of r.commons) if (!commonBlocks.has(c.id)) commonBlocks.set(c.id, c);
  }
  errors.throwIfAny();

  const acfMap = {
    // プロジェクト名。--project で明示できる（.ichiki.json の project を渡す）。
    project: projectName || path.basename(path.resolve(rootDir, '..', '..')),
    generated_by: 'ichiki scan（変換器のモデルから生成）',
    common: [...commonBlocks.values()],
    pages,
  };

  const totals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  let grandTotal = 0;
  for (const c of coverages) {
    grandTotal += c.total;
    for (const b of BUCKETS) totals[b] += c.counts[b];
  }
  const sum = BUCKETS.reduce((s, b) => s + totals[b], 0);
  const coverage = {
    total_text_nodes: grandTotal,
    buckets: totals,
    sum_of_buckets: sum,
    unaccounted: grandTotal - sum,
    per_page: coverages,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'acf-map.yaml'), yaml.dump(acfMap, { lineWidth: 120, noRefs: true }), 'utf8');
  fs.writeFileSync(path.join(outDir, 'coverage.json'), JSON.stringify(coverage, null, 2), 'utf8');

  // 案件設定（.ichiki.json）を用意する。
  // 無ければ作り、title_separator が無ければ足す。人が JSON を手打ちする場面を消す。
  // theme_dir と site_url は環境依存なので埋められない。空で出して doctor に任せる。
  ensureProjectConfig(confPath, conf, rootDir, acfMap.project, model, titleSeparator);

  const tmplPath = path.join(__dirname, '..', 'templates', 'CLAUDE.md.tmpl');
  if (fs.existsSync(tmplPath)) {
    fs.writeFileSync(path.join(outDir, 'CLAUDE.md'), renderClaudeMd(acfMap, tmplPath), 'utf8');
  }

  let fieldCount = 0;
  for (const c of acfMap.common) fieldCount += c.fields.length;
  for (const p of pages) for (const s of p.sections) fieldCount += s.fields.length;

  console.log('--- scan 結果 ---');
  console.log(`pages            : ${pages.length}`);
  console.log(`fields           : ${fieldCount}`);
  console.log('');
  console.log('--- テキスト取りこぼし検証 ---');
  console.log(`全テキストノード           : ${grandTotal}`);
  for (const b of BUCKETS) console.log(`  ${b.padEnd(24)}: ${totals[b]}`);
  console.log(`分類合計                   : ${sum}`);
  console.log(`未分類（取りこぼし）       : ${coverage.unaccounted}`);
  console.log('');
  console.log(coverage.unaccounted === 0 ? 'RESULT: 取りこぼしゼロ' : 'RESULT: 取りこぼしあり');
  if (totals.unclaimed > 0) {
    console.log(
      `注意: unclaimed ${totals.unclaimed}件 は「宣言が無い＝暗黙の固定文言」。取りこぼしではないが、` +
        `お客様と「更新対象外」の合意が必要（lint L20 と同じ集合）。`
    );
  }
  process.exit(coverage.unaccounted === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  if (err && err.isConversionError) {
    console.error(`スキャンエラー（推測せず停止）:\n${err.message}`);
    process.exit(1);
  }
  throw err;
}
