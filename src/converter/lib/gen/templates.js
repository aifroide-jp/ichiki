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
  // 検査は**全ページ**に対して行う。header.php を組む素材は基準ページ1枚だが、
  // 宣言の無い要素は「どのページに書かれているか」に関係なく事故のもとなので、
  // 基準ページだけ見ていると他ページの分をすり抜ける（実測でそうなっていた）。
  for (const p of model.allPages || []) {
    if (p === headerEntry.page) continue;
    if (!p.commonHeaderEl) continue;
    renderBetween(p, model, p.commonHeaderEl, errors, true);
  }
  const between = renderBetween(headerEntry.page, model, headerEntry.el, errors, true);
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
//
// **拾うのは data-common が付いたものだけ。** 宣言の無い要素があればエラーで止める。
//
// 以前は「間にあるものを全部」拾っていた。header.php は基準ページ1枚から作られるので、
// **そのページ固有の中身が全ページへ配られる**。
// 実測: about/biodiversity.html だけ breadcrumb と page-header が <main> の外にあり、
// 「生物多様性とは？」というパンくずの現在地と曽根干潟の背景写真が、
// 全ページ共通の header.php に焼き込まれていた。検査8本を全部通り抜けた。
//
// 「全ページに共通して在るものを拾う」という直し方は採らない。それは推測であり、
// scan から削除したのと同じ手口になる。しかも**全ページに在るが別部品**のもの
// （フロートのお問い合わせボタン等）を必ず取り違える。宣言だけを見る。
// requireDeclaration: header.php（全ページ共通）を組むときだけ true。
// 自前シェル（vocabulary.md 4.1）は1ページで完結するので、宣言を要求しない。
// そのページの中身がそのページにだけ出るのは正しい。
function renderBetween(page, model, headerEl, errors, requireDeclaration) {
  const $ = page.$;
  const main = $('#main-content').get(0);
  if (!main || !headerEl.sourceCodeLocation || !main.sourceCodeLocation) return '';
  const start = headerEl.sourceCodeLocation.endTag
    ? headerEl.sourceCodeLocation.endTag.endOffset
    : headerEl.sourceCodeLocation.endOffset;
  const end = main.sourceCodeLocation.startOffset;
  if (end <= start) return '';

  const out = [];
  for (const node of $('body').get(0).children || []) {
    if (node.type !== 'tag' || !node.sourceCodeLocation) continue;
    if (node.sourceCodeLocation.startOffset < start) continue;
    if (node.sourceCodeLocation.endOffset > end) continue;

    if (requireDeclaration && !(node.attribs || {})['data-common']) {
      const cls = (node.attribs || {}).class;
      errors.add(
        page.relPath,
        node.sourceCodeLocation.startLine,
        `<${node.name}${cls ? ` class="${cls}"` : ''}> が <header> と <main> の間にありますが ` +
          'data-common がありません。全ページ共通なら data-common を宣言し、' +
          'このページだけのものなら <main> の中へ移してください' +
          '（ここは header.php に入るため、宣言の無いものを拾うとページ固有の中身が全ページに出ます）'
      );
      continue;
    }
    // header.php が直接展開するので、テンプレートパーツは作らない（generateCommonTemplateParts）
    if (!model.shellCommonNames) model.shellCommonNames = new Set();
    model.shellCommonNames.add((node.attribs || {})['data-common']);
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
  // ここにページ末尾のスクリプトは入れない。footer.php は全ページ共通なので、
  // 1ページぶんの処理を入れると全ページに配られる（header.php でパンくずを配った件と同じ形）。
  lines.push('<?php wp_footer(); ?>');
  lines.push('</body>');
  lines.push('</html>');
  return lines.join('\n');
}

// data-common="header"/"footer" 以外(例: "cta")は template-parts/common-<name>.php に切り出す。
function generateCommonTemplateParts(model, errors) {
  const parts = [];
  // header.php / footer.php が直接展開するものは、テンプレートパーツにしない。
  // header と footer 自身に加え、**<header> と <main> の間に置かれたもの**（モバイルナビ等）も
  // header.php が展開済み。パーツを作っても誰からも呼ばれず、置き場所だけが2つになる。
  const inlinedInShell = new Set(['header', 'footer', ...(model.shellCommonNames || [])]);
  for (const [name, entry] of model.commonMap) {
    if (inlinedInShell.has(name)) continue;
    const html = renderFragment(entry.page, model, entry.el, true, errors, 'site_options');
    const content = ['<?php', `/** template-parts/common-${name}.php (data-common="${name}" から生成) */`, '?>', html, ''].join(
      '\n'
    );
    parts.push({ filename: `template-parts/common-${name}.php`, content });
  }
  return parts;
}

// ページ内に直接書かれた <script>。**捨てない。**
// モックでは </body> 直前に置かれていることが多いが、そこはどの領域にも属さないので
// 何もしないと消える（実測: 地図と絞り込みが処理ごと落ちていた）。
// ページテンプレートの末尾に置けば、そのページでだけ動く。
function trailingScriptHtml(page) {
  const list = (page && page.trailingScripts) || [];
  if (!list.length) return '';
  return list.map((code) => `<script>${code}</script>`).join('\n');
}

function wrapPageBody(templateNameComment, innerHtml, page) {
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
  const tail = trailingScriptHtml(page);
  if (tail) lines.push(tail);
  lines.push('<?php get_footer(); ?>');
  return lines.join('\n');
}

function generateFrontPageTemplate(model, errors) {
  if (!model.front) {
    errors.add('(model)', null, 'data-page="front" のページが見つかりません(front-page.phpを生成できません)');
    return null;
  }
  const html = renderFragment(model.front, model, model.front.mainEl, false, errors);
  return { filename: 'front-page.php', content: wrapPageBody(null, html, model.front) };
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
  const between = renderBetween(page, model, page.ownHeaderEl, errors, false);
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
  const tail = trailingScriptHtml(page);
  if (tail) { lines.push(tail); lines.push(''); }
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
      : wrapPageBody(pageId, html, page);
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
      p.ownsShell ? wrapOwnShellPage(model, p, null, html, errors) : wrapPageBody(null, html, p);

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

// テーマの素性は**案件から決まる**。
// 以前は "Nature Kitakyushu (Mockup Converter PoC)" と検証時の名前が焼き込まれ、
// Description には移設で消えたパス（proposal/converter）が書いてあった。
// そのまま本番に載ると、お客様の管理画面に PoC と表示される。
function generateStyleCss(model) {
  const site = (model && model.siteTitle && model.siteTitle.siteName) || 'Site';
  const tagline = (model && model.siteTitle && model.siteTitle.tagline) || '';
  return [
    '/*',
    `Theme Name: ${site}`,
    `Description: ${tagline ? tagline + ' ' : ''}モックアップから Ichiki が生成したテーマ。`,
    'Version: 1.0.0',
    `Text Domain: ${(model && model.themeSlug) || 'theme'}`,
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
