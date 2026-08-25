#!/usr/bin/env node
'use strict';

// 構造忠実性チェック(独立検証): モックの class 名の集合 vs 生成テーマの class 名の集合を
// 突き合わせ、「モックにあって生成物に無い class」を検出する。
//
// 背景: 変換器の既存検証(verify-coverage.js)は data-acf → the_field() の
// フィールド網羅性しか見ておらず、class名・DOM構造がモックと一致しているかを見る
// チェックがどこにも無かった。そのため、nav の <li class="site-nav__item"> が
// wp_nav_menu() の既定class に置き換わって消える欠陥(モックと1:1という契約の違反)が
// 検出されないまま残っていた。このスクリプトはその再発防止用の自己チェック。
//
// 設計方針(verify-coverage.js と同じ): buildModel() など変換器内部のモデルには依存しない。
// モデルのバグとこのチェックのバグが打ち消し合って「一致して見える」事故を避けるため、
// モックHTML・生成PHPの両方を生の文字列/独立パースから直接読み取る。
//
// 「正当な差分」として除外するのは次の2種類のみ、理由もここに明記する:
//
// 1. data-loop-sample 配下にのみ現れる class
//    → 変換器(lib/render.js)が該当要素を丸ごと破棄するデザイン確認用ダミー(vocabulary.md 3章)。
//      実装は「data-loop-sample を持つ要素を DOM から削除してから class を集計する」ことで
//      機械的に実現する(除外リストを別途持つのではなく、変換器の実際の挙動をそのまま模倣する)。
//      これにより、同じ class が data-loop-item 側(実際に残る側)にも使われていれば
//      自動的に除外されない(除外されるのは data-loop-sample にしか出現しない class だけ)。
//
// 2. wp_nav_menu() のフラットナビ(<ul><li><a>) の <li>/<a> の class
//    → 各メニュー項目は wp-admin 側で管理する実行時データのため、<li> を静的PHP文字列として
//      焼き込めない。nav_menu_css_class / nav_menu_link_attributes フィルタ経由で実行時に
//      付与する以外に方法が無く、genPHPソースには class="..." という文字列として現れない。
//      ただし「本当にフィルタ経由で出力されるか」を確認せずに除外すると、今回のバグ
//      (フィルタ自体が実装されておらず、classが本当に欠落していたケース)を見逃す。
//      そのためこのスクリプトは、(a) 対象classを値に持つ $nkk_nav_flat_classes 登録配列と
//      (b) その配列を参照する nkk_nav_menu_css_class / nkk_nav_menu_link_attributes が
//      実際に add_filter() でフックされていること の両方を functions.php 内で確認できた
//      場合に限り除外する。(a)(b) いずれかが確認できない class は、たとえ動的生成が
//      理由だと弁明されても「欠落」として報告する(=これが本バグを実際に捕まえる仕組み)。
//
// grouped(footer 等)の Walker は start_el/start_lvl を変換器が PHP コードとして直接生成する
// ため、divClass/ulClass/liClass/headingClass/aClass はすべて生成時に確定する静的文字列として
// class="..." の形でソースに焼き込まれる。したがってこの経路は上記1つ目の
// naive な class="..." 走査でそのまま検出できる(=専用の除外ルールは不要)。

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { findHtmlFiles } = require('../converter/lib/discover');
const { CPT_PREFIX } = require('../converter/lib/constants');

// --- モック側: ページごとの class 集合を求める ---

function bodyAttrs(html) {
  const m = html.match(/<body\b([^>]*)>/i);
  const attrs = {};
  if (!m) return attrs;
  const attrRe = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let a;
  while ((a = attrRe.exec(m[1]))) attrs[a[1]] = a[2];
  return attrs;
}

function mockClassesForPage(html) {
  const $ = cheerio.load(html);
  // vocabulary.md 3章: data-loop-sample は変換器が丸ごと破棄するダミー。
  // 実際の変換結果に忠実に比較するため、集計前に DOM から取り除く。
  $('[data-loop-sample]').remove();
  // data-cf7-field を宣言した要素は、CF7 のフォームタグ1つに丸ごと置き換わる(6章)。
  // 宣言した要素自身の class / id はタグオプション(class:xxx)として引き継がれるが、
  // **中のマークアップは CF7 が自前で組む**ため残らない。
  // 実測: <div class="radio-group" data-cf7-field="transport"> の中の
  // <label class="radio-label"> が該当。CLAUDE.md が「モックと1:1にならない唯一の例外」
  // として記録しているのがこれ。
  // ここも data-loop-sample と同じく、除外リストを持つのではなく変換器の挙動を模倣する
  // （同じ class がフォームの外でも使われていれば、除外されず欠落として報告される）。
  $('[data-cf7-field]').each((_, el) => $(el).children().remove());
  const set = new Set();
  $('[class]').each((_, el) => {
    const val = $(el).attr('class');
    if (!val) return;
    for (const c of val.split(/\s+/).filter(Boolean)) set.add(c);
  });
  return set;
}

// data-page/data-cpt/data-page-id から、このモックページに対応する生成テンプレートの
// ファイル名を求める(buildModel() は使わず、属性を直接読む=verify-coverage.js と同方針)。
//
// header.php/footer.php/template-parts/*.php に加え inc/*.php も常に候補に含める。
// 理由: Nkk_Grouped_Nav_Walker のように「PHPコード生成時に確定する静的class文字列」が
// functions.php 側に置かれることがあり、また data-cf7 のフォームは <form> 要素ごと
// 丸ごと CF7 ショートコード呼び出しに置換される(ichiki.md「form要素はCF7のショートコードへ
// 置換する」)ため、周辺のラベル・必須マーク等のHTML(class="form-group"等)は
// inc/seed-cf7.php の CF7 フォーム本文文字列(ヒアドキュメント)の中に転記される。
// page-<id>.php 等には現れないため、候補を広げないと存在するのに「欠落」と誤検出する。
function templateFilesFor(attrs, templatePartFiles, incFiles) {
  const common = ['header.php', 'footer.php', 'functions.php', ...templatePartFiles, ...incFiles];
  const dataPage = attrs['data-page'];
  if (dataPage === 'front') return [...common, 'front-page.php'];
  if (dataPage === 'page' && attrs['data-page-id']) {
    return [...common, `page-${attrs['data-page-id']}.php`];
  }
  if (dataPage === 'single' && attrs['data-cpt']) {
    // data-page-variant は同じ投稿の別テンプレート。出力先は single-<cpt>-<variant>.php で、
    // 詳細ページ本体とは中身が違う（見ないと、変換されているのに「欠落」と誤検出する）。
    if (attrs['data-page-variant']) {
      return [...common, `single-${CPT_PREFIX}${attrs['data-cpt']}-${attrs['data-page-variant']}.php`];
    }
    return [...common, `single-${CPT_PREFIX}${attrs['data-cpt']}.php`];
  }
  if (dataPage === 'archive' && attrs['data-cpt']) {
    return [...common, `archive-${CPT_PREFIX}${attrs['data-cpt']}.php`];
  }
  return common; // data-page が無い/未知の値 → 共通部のみで比較(過小報告よりは安全側)
}

// --- 生成テーマ側: PHP ソースに文字列として現れる class="..." / class='...' を集計する ---

function literalClassesInText(text) {
  const set = new Set();

  // 通常のHTML class属性(PHP文字列リテラル内のHTML片も含め、そのまま拾える)。
  const htmlAttrRe = /class\s*=\s*(["'])([^"']*)\1/g;
  let m;
  while ((m = htmlAttrRe.exec(text))) {
    for (const c of m[2].split(/\s+/).filter(Boolean)) set.add(c);
  }

  // CF7 6.x のフォームタグは `class="..."` ではなく `class:value` というタグオプション
  // 構文でclassを指定する(ichiki.md「CF7 6.x固有の注意事項」参照)。data-cf7 は <form>
  // 要素ごとショートコード呼び出しに置換されるため、入力欄のclassはこの構文でのみ
  // inc/*.php 中に現れる。これは「動的で確認できない」ケースではなく、変換器が生成時に
  // 確定させて焼き込む静的文字列(構文が違うだけ)なので、除外リストではなくここで
  // 同列に検出する。
  const cf7TagOptionRe = /\bclass:([A-Za-z0-9_-]+)/g;
  while ((m = cf7TagOptionRe.exec(text))) {
    set.add(m[1]);
  }

  return set;
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// $nkk_nav_flat_classes 経由でフィルタが実際に出力する class を、フィルタが
// フックされていることまで確認できた場合に限り集める(確認できなければ何も返さない)。
function confirmedDynamicNavClasses(functionsPhpText) {
  const confirmed = new Set();
  if (!functionsPhpText) return confirmed;

  const registryMatch = functionsPhpText.match(/\$nkk_nav_flat_classes\s*=\s*array\(([\s\S]*?)\n\);/);
  if (!registryMatch) return confirmed; // 登録配列が無い → 何も確認できない

  const hasCssClassFilterFn = /function\s+nkk_nav_menu_css_class\s*\(/.test(functionsPhpText);
  const hasCssClassHook = /add_filter\(\s*'nav_menu_css_class'\s*,\s*'nkk_nav_menu_css_class'/.test(functionsPhpText);
  const hasLinkAttrFilterFn = /function\s+nkk_nav_menu_link_attributes\s*\(/.test(functionsPhpText);
  const hasLinkAttrHook = /add_filter\(\s*'nav_menu_link_attributes'\s*,\s*'nkk_nav_menu_link_attributes'/.test(
    functionsPhpText
  );

  const body = registryMatch[1];
  // 'theme_location' => array( 'li' => 'xxx', 'a' => 'yyy' または null )
  const entryRe = /'li'\s*=>\s*(?:'([^']*)'|null)\s*,\s*'a'\s*=>\s*(?:'([^']*)'|null)/g;
  let m;
  while ((m = entryRe.exec(body))) {
    if (m[1] && hasCssClassFilterFn && hasCssClassHook) confirmed.add(m[1]);
    if (m[2] && hasLinkAttrFilterFn && hasLinkAttrHook) confirmed.add(m[2]);
  }
  return confirmed;
}

function listTemplatePartFiles(themeDir) {
  const dir = path.join(themeDir, 'template-parts');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.php'))
    .map((f) => path.join('template-parts', f));
}

function listIncFiles(themeDir) {
  const dir = path.join(themeDir, 'inc');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.php'))
    .map((f) => path.join('inc', f));
}

function main() {
  const [, , mockupDirArg, themeDirArg] = process.argv;
  if (!mockupDirArg || !themeDirArg) {
    console.error('使い方: node verify-structure.js <mockupDir> <themeDir>');
    process.exit(2);
  }
  const mockupDir = path.resolve(mockupDirArg);
  const themeDir = path.resolve(themeDirArg);

  const functionsPhpText = readFileSafe(path.join(themeDir, 'functions.php'));
  const dynamicAllowed = confirmedDynamicNavClasses(functionsPhpText);

  const templatePartFiles = listTemplatePartFiles(themeDir);
  const incFiles = listIncFiles(themeDir);
  const fileClassCache = new Map(); // relFilename -> Set(class) | null(存在しない)

  function classesInThemeFile(relFilename) {
    if (fileClassCache.has(relFilename)) return fileClassCache.get(relFilename);
    const text = readFileSafe(path.join(themeDir, relFilename));
    const set = text === null ? null : literalClassesInText(text);
    fileClassCache.set(relFilename, set);
    return set;
  }

  const files = findHtmlFiles(mockupDir);
  let totalMockClasses = 0;
  let totalMissing = 0;
  const rows = [];
  const missingFileNotes = new Set();

  for (const f of files) {
    const html = fs.readFileSync(f.abs, 'utf8');
    const attrs = bodyAttrs(html);
    const mockClasses = mockClassesForPage(html);
    const candidateFiles = templateFilesFor(attrs, templatePartFiles, incFiles);

    const availableClasses = new Set(dynamicAllowed);
    for (const rel of candidateFiles) {
      const set = classesInThemeFile(rel);
      if (set === null) {
        missingFileNotes.add(`${rel}(対応する生成ファイルが存在しません)`);
        continue;
      }
      for (const c of set) availableClasses.add(c);
    }

    const missing = [...mockClasses].filter((c) => !availableClasses.has(c)).sort();
    totalMockClasses += mockClasses.size;
    totalMissing += missing.length;
    rows.push({ rel: f.rel, declared: mockClasses.size, missing, candidateFiles });
  }

  console.log('=== 構造忠実性チェック: モック class 名 vs 生成テーマ class 名(ページ別) ===');
  for (const r of rows) {
    const status = r.missing.length ? `欠落 ${r.missing.length}件: ${r.missing.join(', ')}` : 'OK';
    console.log(`${r.rel} (対応ファイル: ${r.candidateFiles.join(', ')}): ${status}`);
  }
  if (missingFileNotes.size > 0) {
    console.log('');
    console.log('注意: 以下の対応ファイルが生成物に存在しませんでした(比較対象から除外して継続):');
    for (const n of missingFileNotes) console.log(`  - ${n}`);
  }
  console.log('');
  if (dynamicAllowed.size > 0) {
    console.log(
      `正当な除外として扱った class(フィルタのフック実装を確認済み): ${[...dynamicAllowed].sort().join(', ')}`
    );
  }
  console.log(`合計: 欠落 ${totalMissing} / モック側 class 出現ページ数 ${totalMockClasses}`);
  process.exit(totalMissing === 0 ? 0 : 1);
}

main();
