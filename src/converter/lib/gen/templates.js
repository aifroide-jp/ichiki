'use strict';

const { renderFragment } = require('../render');
const { CPT_PREFIX } = require('../constants');

function generateHeaderPhp(model, errors) {
  const headerEntry = model.commonMap.get('header');
  if (!headerEntry) {
    errors.add('(model)', null, 'data-common="header" が見つかりません(header.phpを生成できません)');
    return null;
  }
  // data-common のフィールドは site-options グループに登録される（acf.js）。
  const headerHtml = renderFragment(headerEntry.page, model, headerEntry.el, true, errors, 'site_options');

  const lines = [];
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="ja">');
  lines.push('<head>');
  lines.push('<meta charset="UTF-8">');
  lines.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  // モックの <head> にある外部リソース（Web フォント・favicon）。model.js 参照。
  for (const l of model.headLinks || []) lines.push(l);
  lines.push('<?php wp_head(); ?>');
  lines.push('</head>');
  lines.push('<body <?php body_class(); ?>>');
  lines.push('<?php wp_body_open(); ?>');
  if (model.skipLinkHtml) lines.push(model.skipLinkHtml);
  lines.push('');
  lines.push(headerHtml);
  lines.push('');
  // header と <main> の間にある要素も出す。
  // 実測: モバイルナビ（<nav data-nav="mobile">）が <header> の外・<main> の前に
  // 置かれており、data-common と <main> しか拾っていなかったため**丸ごと消えていた**。
  // 生成物にも実サイトにも存在せず、検査も「要素が無い」で素通りしていた。
  const between = renderBetween(headerEntry.page, model, headerEntry.el, errors);
  if (between.trim()) {
    lines.push(between);
    lines.push('');
  }
  lines.push('<main id="main-content">');
  lines.push('');
  return lines.join('\n');
}

// data-common="header" の直後から <main id="main-content"> の直前までを描画する。
// ここに置かれた要素（モバイルナビ等）は共通領域でも本文でもないが、
// 全ページに出る必要があるので header.php に含める。
function renderBetween(page, model, headerEl, errors) {
  const $ = page.$;
  const main = $('#main-content').get(0);
  if (!main || !headerEl.sourceCodeLocation || !main.sourceCodeLocation) return '';
  const start = headerEl.sourceCodeLocation.endTag
    ? headerEl.sourceCodeLocation.endTag.endOffset
    : headerEl.sourceCodeLocation.endOffset;
  const end = main.sourceCodeLocation.startOffset;
  if (end <= start) return '';
  // 間にある要素を1つずつ描画する（data-* の除去・nav の置換を通すため）
  const out = [];
  for (const node of $('body').get(0).children || []) {
    if (node.type !== 'tag' || !node.sourceCodeLocation) continue;
    if (node.sourceCodeLocation.startOffset < start) continue;
    if (node.sourceCodeLocation.endOffset > end) continue;
    out.push(renderFragment(page, model, node, true, errors, 'site_options'));
  }
  return out.join('\n');
}

function generateFooterPhp(model, errors) {
  const footerEntry = model.commonMap.get('footer');
  if (!footerEntry) {
    errors.add('(model)', null, 'data-common="footer" が見つかりません(footer.phpを生成できません)');
    return null;
  }
  const footerHtml = renderFragment(footerEntry.page, model, footerEntry.el, true, errors, 'site_options');

  const lines = [];
  lines.push('</main>');
  lines.push('');
  lines.push(footerHtml);
  lines.push('');
  lines.push('<?php wp_footer(); ?>');
  lines.push('</body>');
  lines.push('</html>');
  return lines.join('\n');
}

// data-common="header"/"footer" 以外(例: "cta")は template-parts/common-<name>.php に切り出す。
function generateCommonTemplateParts(model, errors) {
  const parts = [];
  for (const [name, entry] of model.commonMap) {
    if (name === 'header' || name === 'footer') continue;
    const html = renderFragment(entry.page, model, entry.el, true, errors, 'site_options');
    const content = ['<?php', `/** template-parts/common-${name}.php (data-common="${name}" から生成) */`, '?>', html, ''].join(
      '\n'
    );
    parts.push({ filename: `template-parts/common-${name}.php`, content });
  }
  return parts;
}

function wrapPageBody(templateNameComment, innerHtml) {
  const lines = [];
  lines.push('<?php');
  if (templateNameComment) {
    lines.push('/**');
    lines.push(` * Template Name: ${templateNameComment}`);
    lines.push(' */');
  }
  lines.push('get_header();');
  lines.push('?>');
  lines.push(innerHtml);
  lines.push('<?php get_footer(); ?>');
  return lines.join('\n');
}

function generateFrontPageTemplate(model, errors) {
  if (!model.front) {
    errors.add('(model)', null, 'data-page="front" のページが見つかりません(front-page.phpを生成できません)');
    return null;
  }
  const html = renderFragment(model.front, model, model.front.mainEl, false, errors);
  return { filename: 'front-page.php', content: wrapPageBody(null, html) };
}

// data-common="header" を宣言していないページ（= 自前シェル）は get_header()/get_footer()
// を呼べないので、1枚で完結したドキュメントを出す。
// header.php と同じ scaffold をここでも組むが、<header>/<footer> の中身はページのもの。
function wrapOwnShellPage(model, page, pageId, innerHtml, errors) {
  // includeSelf = true。<header>/<footer> のタグ自体も出力に含める
  // （header.php と同じ扱い。false にすると中身だけになりタグが消える）。
  const headerHtml = renderFragment(page, model, page.ownHeaderEl, true, errors);
  const footerHtml = renderFragment(page, model, page.ownFooterEl, true, errors);

  const lines = [];
  lines.push('<?php');
  lines.push('/**');
  // Template Name: は固定ページの割り当て用。CPT のテンプレート（single-*.php 等）は
  // ファイル名で選ばれるので付けない（付けると固定ページの選択肢に紛れ込む）。
  if (pageId) lines.push(` * Template Name: ${pageId}`);
  lines.push(' * サイト共通ヘッダー／フッターを使わないページ。');
  lines.push(' * モックが data-common="header" を宣言していないため、シェルごとこのページのもの。');
  lines.push(' */');
  lines.push('?>');
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="ja">');
  lines.push('<head>');
  lines.push('<meta charset="UTF-8">');
  lines.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  // モックの <head> にある外部リソース（Web フォント・favicon）。model.js 参照。
  for (const l of model.headLinks || []) lines.push(l);
  lines.push('<?php wp_head(); ?>');
  lines.push('</head>');
  lines.push('<body <?php body_class(); ?>>');
  lines.push('<?php wp_body_open(); ?>');
  if (model.skipLinkHtml) lines.push(model.skipLinkHtml);
  lines.push('');
  lines.push(headerHtml);
  lines.push('');
  // header.php と同じく、<header> と <main> の間の要素も出す。
  // 実測: 申込ページのパンくず（<nav class="breadcrumb">）がここに置かれており、
  // header.php 側にしか renderBetween が無かったため丸ごと消えていた。
  const between = renderBetween(page, model, page.ownHeaderEl, errors);
  if (between.trim()) {
    lines.push(between);
    lines.push('');
  }
  lines.push('<main id="main-content">');
  lines.push('');
  lines.push(innerHtml);
  lines.push('');
  lines.push('</main>');
  lines.push('');
  lines.push(footerHtml);
  lines.push('');
  lines.push('<?php wp_footer(); ?>');
  lines.push('</body>');
  lines.push('</html>');
  return lines.join('\n');
}

function generatePageTemplates(model, errors) {
  const out = [];
  for (const [pageId, entry] of model.pageMap) {
    const page = entry.page;
    const html = renderFragment(page, model, page.mainEl, false, errors);
    const content = page.ownsShell
      ? wrapOwnShellPage(model, page, pageId, html, errors)
      : wrapPageBody(pageId, html);
    out.push({ filename: `page-${pageId}.php`, content });
  }
  return out;
}

function generateSiteOptionsPageTemplate() {
  const content = [
    '<?php',
    '/**',
    ' * Template Name: site-options',
    ' * サイト共通フィールド(inc/acf-site-options.php)を保持するための非表示ページ。',
    ' * ナビ・検索結果には出さない運用を想定(公開設定は運用側で管理する)。',
    ' */',
    'get_header();',
    '?>',
    '<div class="container"><p>このページはサイト共通設定の保持専用です。</p></div>',
    '<?php get_footer(); ?>',
  ].join('\n');
  return { filename: 'page-site-options.php', content };
}

function generateCptTemplates(model, errors) {
  const out = [];
  for (const [cpt, entry] of model.cptMap) {
    const postType = `${CPT_PREFIX}${cpt}`;

    // 自前シェル（data-common="header" を書かないページ / vocabulary.md 4.1）は
    // CPT のテンプレートでも同じ扱いにする。
    //
    // ここが固定ページ側にしか無かったため、申込ページ（data-page-variant="apply"）が
    // 共通ヘッダー・共通フッターで出ていた。モックは離脱防止のためナビも CTA も落とした
    // 簡易シェルなのに、生成物はナビ付きの通常ページになっていた（実測: header__back-link /
    // footer--minimal / apply-wrap など8つの class が出力に存在しなかった）。
    const wrap = (p, html) =>
      p.ownsShell ? wrapOwnShellPage(model, p, null, html, errors) : wrapPageBody(null, html);

    if (entry.archivePage) {
      const html = renderFragment(entry.archivePage, model, entry.archivePage.mainEl, false, errors);
      out.push({ filename: `archive-${postType}.php`, content: wrap(entry.archivePage, html) });
    }
    // vocabulary.md 未決事項3: 単一インスタンスCPTのarchiveテンプレート要否は未定義。
    // 対応する data-page="archive" のモックが無いCPT(例: network)は archive-*.php を生成しない
    // (存在しないモックから構造を推測しない)。

    if (entry.canonicalSingle) {
      const html = renderFragment(entry.canonicalSingle, model, entry.canonicalSingle.mainEl, false, errors);
      out.push({ filename: `single-${postType}.php`, content: wrap(entry.canonicalSingle, html) });
      // data-page-variant: 同じ投稿の別テンプレート（例 single-nkk_event-apply.php）。
      // URL は add_rewrite_endpoint で /<投稿のパーマリンク>/<variant>/ になる（functions.php）。
      for (const [vname, vpage] of entry.variantPages || []) {
        const vhtml = renderFragment(vpage, model, vpage.mainEl, false, errors);
        out.push({ filename: `single-${postType}-${vname}.php`, content: wrap(vpage, vhtml) });
      }
    } else {
      errors.add('(model)', null, `data-cpt="${cpt}" に対応する data-page="single" のページがありません(single-${postType}.phpを生成できません)`);
    }
  }
  return out;
}

// index.php: テンプレート階層の最終フォールバック。**WordPress のテーマに必須**で、
// 無いと「Template is missing」として壊れたテーマ扱いになり、一覧にも出ない。
// モックにはこれに当たるページが存在しない（どのページも data-page で行き先が決まっている）ため、
// 変換器が最小限のものを作る。実際に表示されるのは、想定外の URL を踏んだときだけ。
function generateIndexPhp() {
  return [
    '<?php',
    '/**',
    ' * index.php',
    ' * テンプレート階層の最終フォールバック（WordPress のテーマに必須）。',
    ' * モックに対応するページは無い。想定外の URL を踏んだときだけ表示される。',
    ' */',
    '',
    'get_header();',
    '?>',
    '<main id="main-content">',
    '  <section class="section section--white">',
    '    <div class="container">',
    '      <?php if ( have_posts() ) : while ( have_posts() ) : the_post(); ?>',
    '        <article>',
    '          <h1><?php the_title(); ?></h1>',
    '          <div><?php the_content(); ?></div>',
    '        </article>',
    '      <?php endwhile; else : ?>',
    '        <p>コンテンツが見つかりませんでした。</p>',
    '      <?php endif; ?>',
    '    </div>',
    '  </section>',
    '</main>',
    '<?php get_footer(); ?>',
    '',
  ].join('\n');
}

function generateStyleCss() {
  return [
    '/*',
    'Theme Name: Nature Kitakyushu (Mockup Converter PoC)',
    'Description: proposal/vocabulary.md 準拠モックアップから proposal/converter が決定的に生成したテーマ。',
    'Version: 0.1.0',
    'Text Domain: nkk',
    '*/',
    '',
  ].join('\n');
}

module.exports = {
  generateHeaderPhp,
  generateFooterPhp,
  generateCommonTemplateParts,
  generateFrontPageTemplate,
  generatePageTemplates,
  generateSiteOptionsPageTemplate,
  generateCptTemplates,
  generateStyleCss,
  generateIndexPhp,
};
