#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { findHtmlFiles } = require('./lib/discover');
const { loadPage } = require('./lib/load-page');
const { ErrorCollector } = require('./lib/errors');
const { buildModel } = require('./lib/model');
const { loadAcfMap, checkAgainstModel, checkFieldTypes } = require('./lib/acf-map');
const { copyAssets } = require('./lib/gen/assets');
const {
  generatePageAcf,
  generateFrontAcf,
  generateCptAcf,
  generateCptArchiveAcf,
  generateSiteOptionsAcf,
} = require('./lib/gen/acf');
const { generateFunctionsPhp } = require('./lib/gen/functions');
const { generateSeedCf7Php } = require('./lib/gen/cf7');
const { generateCf7DynamicPhp } = require('./lib/gen/cf7-filter');
const { generateSeedMenusPhp } = require('./lib/gen/menus');
const { generateSeedPostsPhp } = require('./lib/gen/seed-posts');
const {
  generateHeaderPhp,
  generateFooterPhp,
  generateCommonTemplateParts,
  generateFrontPageTemplate,
  generatePageTemplates,
  generateSiteOptionsPageTemplate,
  generateCptTemplates,
  generateStyleCss,
  generateIndexPhp,
} = require('./lib/gen/templates');

// acf-map.yaml と突き合わせるため、このページに属するフィールド定義を model から集める。
// 置き場所がページ種別ごとに違う（固定ページ / CPT / トップ / 共通）。
function collectPageFields(model, page) {
  const out = [];
  if (page.dataPage === 'page') {
    const e = model.pageMap.get(page.pageId);
    if (e) out.push(...e.fields);
  } else if (page.cpt) {
    const e = model.cptMap.get(page.cpt);
    if (e) {
      if (e.fields) out.push(...e.fields);
      if (e.archiveFields) out.push(...e.archiveFields);
    }
  } else if (page.dataPage === 'front' && model.front && model.front.ownFields) {
    out.push(...model.front.ownFields);
  }
  out.push(...(model.siteOptionFields || []));
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  // --allow-unresolved-links: 未解決の内部リンクをエラーではなく警告にする。
  // 設計原則3（エスケープハッチを作らない）に反するため、**既定では無効**。
  // モックのページを揃える途中で WordPress 上の動作確認まで先に進めるための一時措置で、
  // 全ページが揃ったら外す。渡した場合は生成後に必ず警告の要約を出す。
  const allowUnresolvedLinks = argv.includes('--allow-unresolved-links');
  // --acf-map <path>: Ichiki Phase0 の出力を「宣言の解釈結果の正」として使う。
  // yaml だけではテンプレートを作れない（骨格はモックにしかない）ので、
  // モックと突き合わせ、食い違えば止める。yaml を手で直せば出力が変わる。
  const acfMapIdx = argv.indexOf('--acf-map');
  const acfMapPath = acfMapIdx >= 0 ? argv[acfMapIdx + 1] : null;
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--acf-map');
  const [mockupDirArg, outDirArg] = positional;
  if (!mockupDirArg || !outDirArg) {
    console.error('使い方: node convert.js <mockupDir> <outDir> [--allow-unresolved-links] [--acf-map <acf-map.yaml>]');
    process.exit(2);
  }
  const mockupDir = path.resolve(mockupDirArg);
  const outDir = path.resolve(outDirArg);

  if (!fs.existsSync(mockupDir)) {
    console.error(`入力ディレクトリが存在しません: ${mockupDir}`);
    process.exit(2);
  }

  const files = findHtmlFiles(mockupDir);
  if (files.length === 0) {
    console.error(`HTMLファイルが見つかりません: ${mockupDir}`);
    process.exit(2);
  }

  const pages = files.map((f) => loadPage(f.abs, f.rel));
  const errors = new ErrorCollector();
  errors.allowUnresolvedLinks = allowUnresolvedLinks;

  let model;
  const outputFiles = new Map(); // relPath -> content

  try {
    model = buildModel(pages, errors);

    if (acfMapPath) {
      const map = loadAcfMap(path.resolve(acfMapPath));
      checkAgainstModel(map, pages, errors);
      // 同じフィールドが複数ページのテンプレートに出る（CPT・サイト設定）ので、
      // 読み取り元ページ＋名前で1回だけ照合する。
      const seen = new Set();
      for (const page of pages) {
        const uniq = collectPageFields(model, page).filter((f) => {
          const k = `${f.srcRel || page.relPath}\u0000${f.name}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        checkFieldTypes(map, uniq, page.relPath, errors);
      }
      console.log(`acf-map.yaml と突き合わせました: ${map.byPage.size} ページ / common ${map.common.size} フィールド`);
    }

    // ページ固有 JS は css/page/*.css と同じ規約（js/page/<id>.js があれば enqueue する）。
    // 実在するファイルだけを対象にする（無いファイルを読み込ませない）。
    model.pageJs = new Set();
    const pageJsDir = path.join(mockupDir, 'js', 'page');
    if (fs.existsSync(pageJsDir)) {
      for (const name of fs.readdirSync(pageJsDir)) {
        if (name.endsWith('.js')) model.pageJs.add(name.slice(0, -3));
      }
    }

    // --- functions.php / style.css ---
    outputFiles.set('functions.php', generateFunctionsPhp(model, errors));
    outputFiles.set('style.css', generateStyleCss());
    outputFiles.set('index.php', generateIndexPhp());

    // --- header.php / footer.php / template-parts ---
    const headerPhp = generateHeaderPhp(model, errors);
    if (headerPhp) outputFiles.set('header.php', headerPhp);
    const footerPhp = generateFooterPhp(model, errors);
    if (footerPhp) outputFiles.set('footer.php', footerPhp);
    for (const part of generateCommonTemplateParts(model, errors)) {
      outputFiles.set(part.filename, part.content);
    }

    // --- front-page.php / page-*.php ---
    const front = generateFrontPageTemplate(model, errors);
    if (front) outputFiles.set(front.filename, front.content);
    for (const p of generatePageTemplates(model, errors)) outputFiles.set(p.filename, p.content);
    const siteOptionsTpl = generateSiteOptionsPageTemplate();
    outputFiles.set(siteOptionsTpl.filename, siteOptionsTpl.content);

    // --- archive-*.php / single-*.php ---
    for (const t of generateCptTemplates(model, errors)) outputFiles.set(t.filename, t.content);

    // --- inc/acf-*.php ---
    if (model.front && model.front.ownFields.length > 0) {
      const php = generateFrontAcf(model.front.ownFields, errors);
      if (php) outputFiles.set('inc/acf-front.php', php);
    }
    for (const [pageId, entry] of model.pageMap) {
      const php = generatePageAcf(pageId, entry.fields, errors);
      if (php) outputFiles.set(`inc/acf-${pageId}.php`, php);
    }
    for (const [cpt, entry] of model.cptMap) {
      if (entry.fields && entry.fields.length > 0) {
        outputFiles.set(`inc/acf-${cpt}.php`, generateCptAcf(cpt, entry.fields, !!entry.archivePage, errors));
      }
      if (entry.archiveFields && entry.archiveFields.length > 0) {
        outputFiles.set(`inc/acf-${cpt}-archive.php`, generateCptArchiveAcf(cpt, entry.archiveFields, errors));
      }
    }
    outputFiles.set('inc/acf-site-options.php', generateSiteOptionsAcf(model.siteOptionFields, errors));

    // --- inc/seed-cf7.php ---
    outputFiles.set('inc/seed-cf7.php', generateSeedCf7Php(model, errors));
    // 6.2: 1フォームを複数投稿で使い回すためのフィルタ。宣言が無ければ生成しない。
    const cf7Dynamic = generateCf7DynamicPhp(model);
    if (cf7Dynamic) outputFiles.set('inc/cf7-dynamic.php', cf7Dynamic);
    // モックの nav からメニューを自動投入する（お客様に作らせない）
    const seedMenus = generateSeedMenusPhp(model);
    if (seedMenus) outputFiles.set('inc/seed-menus.php', seedMenus);
    // モックの値をそのまま初期データとして投入する（テンプレートだけでは中身が空になる）
    outputFiles.set('inc/seed-posts.php', generateSeedPostsPhp(model));

    errors.throwIfAny();
  } catch (e) {
    if (e.isConversionError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  // --- ここまでエラー無し。ファイルを書き出す(全部成功するまでテーマを書き出さない) ---
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const [rel, content] of outputFiles) {
    const abs = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  copyAssets(mockupDir, outDir, errors);
  if (errors.hasErrors) {
    console.error(errors.report());
    process.exit(1);
  }

  console.log(`生成完了: ${outDir}`);
  console.log(`ファイル数: ${outputFiles.size + 1 /* style.css 等込み概算 */}`);
  // 警告は生成が成功しても必ず出す（緩めたことが見逃されないようにする）
  const wr = errors.warningReport();
  if (wr) console.log(wr);
}

main();
