#!/usr/bin/env node
'use strict';

// data-acf 宣言数 vs the_field()/get_field() 出力数の突合チェック(独立検証)。
// モックの生HTMLを直接正規表現で走査して「宣言されたフィールド名」を求め、
// 生成済みテーマの *.php を直接正規表現で走査して「出力されたフィールド名」を求め、
// 変換器の内部モデルを一切経由せずに突き合わせる(モデルのバグと出力のバグが
// 相殺して一致して見えてしまう事故を避けるため)。

const fs = require('fs');
const path = require('path');
const { findHtmlFiles } = require('../converter/lib/discover');

function declaredFieldsPerPage(mockupDir) {
  const files = findHtmlFiles(mockupDir);
  const perPage = new Map(); // relPath -> Set(name)
  // <template data-acf="…"> は**フィールドを作るが出力しない**宣言（vocabulary.md 2.8）。
  // 画面に出ないので the_field() も現れない。ここで除かないと必ず「未出力」になる。
  const templateFieldRe = /<template[^>]*\sdata-acf="([^"]+)"/g;
  const dataAcfRe = /data-acf="([^"]+)"/g;
  const dataAcfUrlRe = /data-acf-url="([^"]+)"/g;
  for (const f of files) {
    const html = fs.readFileSync(f.abs, 'utf8');
    const names = new Set();
    let m;
    const outputless = new Set();
    while ((m = templateFieldRe.exec(html))) outputless.add(m[1]);
    while ((m = dataAcfRe.exec(html))) if (!outputless.has(m[1])) names.add(m[1]);
    while ((m = dataAcfUrlRe.exec(html))) names.add(m[1]);
    perPage.set(f.rel, names);
  }
  return perPage;
}

// テーマが持ちうる ACF フィールドキーの接頭辞（field_<scope>_<name> の <scope>）を
// **モックのHTMLだけから**求める。acf.js のグループslug規則と同じ:
//   固定ページ → data-page-id / トップ → front / CPT → data-cpt /
//   CPT一覧の独自フィールド → <cpt>_archive / 共通設定 → site_options
//
// 変換器のモデルを読まないのはこのチェックの前提（独立検証）を保つため。
// scope の集合を持つ理由は、キーから名前を切り出すときの曖昧さを消すこと。
// 集合が無いと field_event_hero_title を「scope=event_hero, name=title」とも読めてしまい、
// 宣言 title が別フィールドと一致して通ってしまう。
function scopeSlugsFromMockup(mockupDir) {
  const scopes = new Set(['site_options']);
  for (const f of findHtmlFiles(mockupDir)) {
    const html = fs.readFileSync(f.abs, 'utf8');
    const body = /<body[^>]*>/i.exec(html);
    if (!body) continue;
    const attr = (n) => {
      const m = new RegExp(`${n}="([^"]+)"`).exec(body[0]);
      return m ? m[1] : null;
    };
    const dataPage = attr('data-page');
    const cpt = attr('data-cpt');
    if (dataPage === 'front') scopes.add('front');
    else if (dataPage === 'page' && attr('data-page-id')) scopes.add(attr('data-page-id'));
    else if (dataPage === 'single' && cpt) scopes.add(cpt);
    else if (dataPage === 'archive' && cpt) {
      scopes.add(cpt);
      scopes.add(`${cpt}_archive`);
    }
  }
  return scopes;
}

function outputFieldNames(themeDir, scopes) {
  const names = new Set();
  // the_field()/get_field() の呼び出しだけを「出力された」とみなす。
  // ACFへの登録('name' => '...')は意図的に対象外にする — CLAUDE.mdが指摘する
  // 「ACFに登録したがテンプレートに出力し忘れる」事故を発見するのがこのチェックの目的であり、
  // 登録済みかどうかは無関係(登録だけされて未出力のフィールドを見逃してはいけない)。
  // CF7 のフォーム本文は文字列として保存されるため PHP を書けない。
  // 代わりに <!--nkk-acf:キー:型--> の目印が埋め込まれ、inc/cf7-dynamic.php の
  // フィルタが表示時に get_field() で差し替える。これも「出力された」に数える。
  const reList = [/the_field\(\s*'([^']+)'/g, /get_field\(\s*'([^']+)'/g, /<!--nkk-acf:([A-Za-z0-9_]+):/g];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'assets') continue;
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith('.php')) {
        const text = fs.readFileSync(abs, 'utf8');
        for (const re of reList) {
          let m;
          while ((m = re.exec(text))) {
            const id = m[1];
            names.add(id);
            // 出力は field_<scope>_<name> のキー指定（同名フィールドが複数CPTにあると
            // 名前引きが別グループに解決するため）。宣言側は名前なので、
            // 既知の scope のときだけ名前部分に戻して突き合わせる。
            for (const s of scopes) {
              const prefix = `field_${s}_`;
              if (id.startsWith(prefix)) names.add(id.slice(prefix.length));
            }
          }
        }
      }
    }
  })(themeDir);
  return names;
}

function main() {
  const [, , mockupDirArg, themeDirArg] = process.argv;
  if (!mockupDirArg || !themeDirArg) {
    console.error('使い方: node verify-coverage.js <mockupDir> <themeDir>');
    process.exit(2);
  }
  const mockupDir = path.resolve(mockupDirArg);
  const themeDir = path.resolve(themeDirArg);

  const perPage = declaredFieldsPerPage(mockupDir);
  const outputNames = outputFieldNames(themeDir, scopeSlugsFromMockup(mockupDir));

  let totalDeclared = 0;
  let totalMatched = 0;
  const rows = [];
  for (const [rel, names] of perPage) {
    let matched = 0;
    const missing = [];
    for (const n of names) {
      if (outputNames.has(n)) matched += 1;
      else missing.push(n);
    }
    totalDeclared += names.size;
    totalMatched += matched;
    rows.push({ rel, declared: names.size, matched, missing });
  }

  console.log('=== data-acf 宣言 vs the_field()/get_field() 出力 突合結果(ページ別) ===');
  for (const r of rows) {
    console.log(`${r.rel}: ${r.matched}/${r.declared}` + (r.missing.length ? `  未出力: ${r.missing.join(', ')}` : ''));
  }
  console.log('');
  console.log(`合計: ${totalMatched}/${totalDeclared}`);
  process.exit(totalMatched === totalDeclared ? 0 : 1);
}

main();
