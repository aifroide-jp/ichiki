#!/usr/bin/env node
'use strict';

// 制約語彙（proposal/vocabulary.md）に準拠したモックアップから
//   - acf-map.yaml   （Ichiki Phase0 の出力形式）
//   - field-map.json （機械命名 → 意味名の対応表）
//   - coverage.json  （テキスト取りこぼしゼロの証明）
// を生成する。
//
// 現行 Phase0 の scan との違いは「推測しないこと」だけである。
//   現行: 祖先探索でセクション名を決め、クラス名の部分一致で hero/main を判定し、
//         nav 配下の href しか拾わない（実測: auma.html は 94本中51本）。
//   本版: data-page / data-section / data-acf / data-nav / data-cf7 の宣言を読むだけ。
//         宣言が無ければ推測せずエラーで停止する。
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
// 分類そのものは proposal/shared/text-classify.js が唯一の実装で、lint L20 と共有する。

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const yaml = require('js-yaml');

// 型導出表・有効な型は proposal/shared/constants.js が唯一の定義場所（vocabulary.md 2.1）。
// テキストの分類は proposal/shared/text-classify.js が唯一の実装で、lint L20 と共有する。
const { TAG_TO_TYPE, VALID_ACF_TYPES } = require('./shared/constants');
const { BUCKETS, classifyPage } = require('./shared/text-classify');

const VALID_TYPES = new Set(VALID_ACF_TYPES);

class ScanError extends Error {}

function fail(file, msg) {
  throw new ScanError(`${file}: ${msg}`);
}

// --- ページID（ichiki.md: 相対パス由来。index.html はディレクトリに畳む） ----
function pageIdFromFile(rel) {
  let p = rel.replace(/\.html$/, '');
  p = p.replace(/(^|\/)index$/, '$1');
  p = p.replace(/\/$/, '');
  if (p === '') return 'index';
  return p.replace(/[\/\-]/g, '_');
}

function findHtml(root) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        walk(abs);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) {
        out.push(abs);
      }
    }
  })(root);
  return out.sort();
}

// --- フィールド抽出 ----------------------------------------------------
function extractFields($, $scope, file) {
  const fields = [];
  $scope.find('[data-acf], [data-acf-url]').addBack('[data-acf], [data-acf-url]').each((_, el) => {
    const $el = $(el);
    const tag = (el.tagName || el.name || '').toLowerCase();

    const urlName = $el.attr('data-acf-url');
    if (urlName) {
      fields.push({
        element: tag,
        field_name: urlName,
        tab: 'section',
        type: 'url',
        default: $el.attr('href') || '',
      });
    }

    const name = $el.attr('data-acf');
    if (!name) return;

    let type = $el.attr('data-acf-type');
    if (type) {
      if (!VALID_TYPES.has(type)) fail(file, `data-acf="${name}": 未知の型 "${type}"`);
    } else {
      type = TAG_TO_TYPE[tag];
      // 推測しない。導出表に無いタグは data-acf-type を要求する。
      if (!type) fail(file, `data-acf="${name}": <${tag}> は型を導出できない。data-acf-type が必要`);
    }

    const f = { element: tag, field_name: name, tab: 'section', type };
    if (type === 'image') {
      f.default = $el.attr('src') || '';
      const alt = $el.attr('alt');
      if (alt) f.alt = alt;
    } else if (type === 'wysiwyg') {
      f.default = $el.html().trim();
    } else {
      f.default = $el.text().trim();
    }
    fields.push(f);
  });
  return fields;
}

// テキストの分類は proposal/shared/text-classify.js に一本化してある。
// lint L20 と同じ関数を使うので、両者の集合は定義上一致する。
function classifyTexts($, file) {
  const { total, counts, unclaimed } = classifyPage($("body").get(0));
  return { file, total, counts, unclaimed };
}

// --- ページ1枚のスキャン ------------------------------------------------
function scanPage(absPath, rootDir) {
  const rel = path.relative(rootDir, absPath).split(path.sep).join('/');
  const html = fs.readFileSync(absPath, 'utf8');
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });

  const $body = $('body');
  const pageType = $body.attr('data-page');
  if (!pageType) fail(rel, '<body> に data-page がない（vocabulary.md 1章）');

  const page = {
    id: pageIdFromFile(rel),
    title: $('title').text().trim(),
    file: rel,
    page_type: pageType,
  };
  if ($body.attr('data-cpt')) page.cpt = $body.attr('data-cpt');
  if ($body.attr('data-page-id')) page.page_id = $body.attr('data-page-id');
  // data-page-variant: 同じ投稿の別テンプレート（vocabulary.md 1.1）。
  // これが無いと申込ページ（single-<cpt>-<variant>.php）を作れない。
  if ($body.attr('data-page-variant')) page.variant = $body.attr('data-page-variant');

  // このページが読む CSS。どのページがどの CSS を読むかは
  // acf-map.yaml だけからテーマを組むのに要る（vocabulary.md 7章）。
  page.css = [];
  $('link[rel="stylesheet"][href]').each((_, el) => {
    const href = $(el).attr('href');
    // 外部の CSS（Google Fonts 等）はテーマの assets に入らないのでそのまま持つ。
    // 正規化するとパスとして壊れる（実測: events/https:/fonts.googleapis.com/... になった）。
    if (/^(https?:)?\/\//i.test(href)) { page.css.push(href); return; }
    // モックルートからの相対に正規化する（../css/page/event.css → css/page/event.css）
    const dir = path.posix.dirname(rel);
    page.css.push(path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, href)));
  });

  // sections（data-common は common 側へ回すのでここでは除く）
  page.sections = [];
  $('[data-section]').each((_, el) => {
    const $s = $(el);
    const id = $s.attr('data-section');
    if (!id) fail(rel, 'data-section の値が空');
    page.sections.push({ id, fields: extractFields($, $s, rel) });
  });

  // ループ宣言（現行 acf-map.yaml には無い情報。制約版の増分）
  const loops = [];
  $('[data-loop]').each((_, el) => {
    const $l = $(el);
    const $item = $l.children('[data-loop-item]');
    loops.push({
      cpt: $l.attr('data-loop'),
      order: $l.attr('data-loop-order') || 'date_desc',
      count: parseInt($l.attr('data-loop-count') || '-1', 10),
      // data-loop-repeat: 同じ中身の子を複数持つループの周回数（vocabulary.md 3.1 / L27）
      repeat: parseInt($l.attr('data-loop-repeat') || '1', 10),
      item_fields: extractFields($, $item, rel).map((f) => f.field_name),
    });
  });
  if (loops.length) page.loops = loops;

  // nav
  page.nav = [];
  $('[data-nav]').each((_, el) => {
    const $n = $(el);
    const links = [];
    $n.find('a[href]').each((__, a) => {
      links.push({ text: $(a).text().trim(), href: $(a).attr('href') });
    });
    page.nav.push({ location: $n.attr('data-nav'), links });
  });

  // forms（CF7）
  page.forms = [];
  $('[data-cf7]').each((_, el) => {
    const $f = $(el);
    const fields = [];
    $f.find('[data-cf7-field]').each((__, i) => {
      const $i = $(i);
      fields.push({
        name: $i.attr('data-cf7-field'),
        tag: ($i.get(0).tagName || $i.get(0).name || '').toLowerCase(),
        type: $i.attr('type') || ($i.get(0).tagName || '').toLowerCase(),
        required: $i.attr('data-cf7-required') !== undefined,
        placeholder: $i.attr('placeholder') || '',
      });
    });
    page.forms.push({ id: $f.attr('data-cf7'), fields });
  });

  // decoration
  page.decoration = [];
  $('[data-deco], [aria-hidden="true"]').each((_, el) => {
    const $d = $(el);
    const tag = (el.tagName || el.name || '').toLowerCase();
    const cls = ($d.attr('class') || '').split(/\s+/).filter(Boolean)[0];
    page.decoration.push({
      selector: cls ? `${tag}.${cls}` : tag,
      reason: $d.attr('data-deco') !== undefined ? 'data-deco' : 'aria-hidden="true"',
    });
  });

  // meta
  page.meta = {
    title: $('title').text().trim(),
    description: $('meta[name="description"]').attr('content') || '',
  };

  // common（全ページに出るので後で1回にまとめる）
  const commons = [];
  $('[data-common]').each((_, el) => {
    const $c = $(el);
    commons.push({ id: $c.attr('data-common'), fields: extractFields($, $c, rel) });
  });

  return { page, commons, coverage: classifyTexts($, rel) };
}

// --- main --------------------------------------------------------------
// 案件用 CLAUDE.md（templates/CLAUDE.md.tmpl から生成）。
// 旧 scan が持っていた機能。差し込み口は3つだけなので、そのまま引き継ぐ。
function renderClaudeMd(acfMap, tmplPath) {
  const tmpl = fs.readFileSync(tmplPath, 'utf8');
  const pageLines = (acfMap.pages || []).map((p) => `- ${p.title} (${p.file})`).join('\n');
  return tmpl
    .replace(/\{\{PROJECT\}\}/g, acfMap.project || '')
    .replace(/\{\{GENERATED\}\}/g, new Date().toISOString().slice(0, 10))
    .replace(/\{\{PAGES\}\}/g, pageLines);
}

function main() {
  const args = process.argv.slice(2);
  const rootDir = path.resolve(process.cwd(), args[0] || path.join(__dirname, '..', 'mockup'));
  const outDir = path.resolve(process.cwd(), args[1] || path.join(__dirname, 'out'));

  const files = findHtml(rootDir);
  if (!files.length) {
    console.error(`*.html が見つかりません: ${rootDir}`);
    process.exit(2);
  }

  const pages = [];
  const coverages = [];
  // data-common は「サイトの共通領域」を指す宣言であって、
  // **全ページが同じ構成を持つことは要求しない**（vocabulary.md 4章）。
  //
  // 申し込みフォームのように、離脱を防ぐためナビも CTA も落とした簡易レイアウトの
  // ページが実在する（実測: events/summer-camp-apply.html はヘッダーにナビが無く、
  // フッターは footer--minimal、CTA バンドも無い）。
  // 変換器はこれを「自前のシェルを持つページ」として扱い、get_header() を呼ばずに
  // 完結した1枚を出す（converter/lib/model.js の ownsShell）。宣言の追加は要らない。
  //
  // したがって scan も、宣言されている id を**和集合**で集めるだけにする。
  // 同じ id なのに中身が違う場合は lint L09 が全ページ横断で検出するので、ここでは見ない。
  const commonBlocks = new Map(); // id -> { id, fields }

  for (const f of files) {
    const { page, commons, coverage } = scanPage(f, rootDir);
    pages.push(page);
    coverages.push(coverage);
    for (const c of commons) if (!commonBlocks.has(c.id)) commonBlocks.set(c.id, c);
  }

  const acfMap = {
    project: path.basename(path.resolve(rootDir, '..', '..')),
    generated_by: 'proposal/scan/scan.js (制約語彙版・推測なし)',
    common: [...commonBlocks.values()],
    pages,
  };

  // field-map.json: 宣言名がそのまま意味名なので恒等写像になる。
  // 現行フローに存在する「機械命名 → 意味名のリネーム」工程が不要であることの証拠。
  const fieldMap = {};
  const collect = (fields, scope) => {
    for (const f of fields) {
      fieldMap[f.field_name] = { generated: f.field_name, semantic: f.field_name, scope };
    }
  };
  for (const c of acfMap.common) collect(c.fields, `common:${c.id}`);
  for (const p of pages) for (const s of p.sections) collect(s.fields, `${p.id}:${s.id}`);

  // coverage
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
  fs.writeFileSync(path.join(outDir, 'field-map.json'), JSON.stringify(fieldMap, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'coverage.json'), JSON.stringify(coverage, null, 2), 'utf8');

  // 案件用 CLAUDE.md。テンプレートが見つかるときだけ出す（本体から呼ばれた場合）。
  const tmplPath = path.join(__dirname, '..', 'templates', 'CLAUDE.md.tmpl');
  if (fs.existsSync(tmplPath)) {
    fs.writeFileSync(path.join(outDir, 'CLAUDE.md'), renderClaudeMd(acfMap, tmplPath), 'utf8');
  }

  const fieldCount = Object.keys(fieldMap).length;
  console.log('--- scan 結果 ---');
  console.log(`pages            : ${pages.length}`);
  console.log(`fields           : ${fieldCount}`);
  console.log(`field-map        : 恒等写像 ${Object.values(fieldMap).every((v) => v.generated === v.semantic) ? 'YES（リネーム工程が不要）' : 'NO'}`);
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
  if (err instanceof ScanError) {
    console.error(`スキャンエラー（推測せず停止）: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
