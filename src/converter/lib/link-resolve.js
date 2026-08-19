'use strict';

// vocabulary.md 2.2:
//   data-acf-url の無い <a> は固定リンクとして、変換器が href をパーマリンクへ機械的に解決する。
//   モック内ファイルへの相対パスは data-page-id / data-cpt から一意に解決できる。
//   外部URL・#アンカー・mailto: はそのまま通す。解決できなければエラー。
//
// v0.1 の実例（役割を終えて削除済みの制約モック）は "../about/x.html" ではなく "/about/x.html" という
// サイトルート絶対パスを使っている。vocabulary.md の例は前者のみを示しており、
// この違いは vocabulary.md 未記載のギャップ（本PoCで発見した点として報告する）。
// 本実装はどちらの形式も同じ「サイトパス」に正規化して解決する。

const path = require('path');

function sitePathForRel(rel) {
  if (rel === 'index.html') return '';
  if (rel.endsWith('/index.html')) return rel.slice(0, -'index.html'.length);
  return rel;
}

// 現在ページ(currentRel)からの href を、モックのファイルツリー基準の「サイトパス」に正規化する。
// 戻り値: { kind: 'anchor'|'scheme'|'external'|'internal', sitePath?, raw }
function classifyHref(href, currentRel) {
  if (href.startsWith('#')) return { kind: 'anchor', raw: href };
  if (/^(mailto|tel):/i.test(href)) return { kind: 'scheme', raw: href };
  if (/^https?:\/\//i.test(href)) return { kind: 'external', raw: href };
  if (href.startsWith('//')) return { kind: 'external', raw: href };

  const clean = href.split('#')[0].split('?')[0];

  if (clean.startsWith('/')) {
    let sp = clean.slice(1);
    if (sp !== '' && sp.endsWith('/index.html')) sp = sp.slice(0, -'index.html'.length);
    return { kind: 'internal', sitePath: sp, raw: href };
  }

  // 現在ページ相対のパス。"../about/x.html"(vocabulary.md の例と同形)に加え、
  // "spots/index.html" のような "./"/"../" 接頭辞の無いサブディレクトリ相対形式も
  // v0.1 mockup(ルート絶対パス→階層相対パス移行後)で使われている。どちらも
  // path.posix.join(currentDir, clean) で同じに解決できるため、接頭辞の有無で
  // 分岐する必要は無い(以前は接頭辞が無いと 'unknown' 扱いになり、ルート直下ページ
  // からサブディレクトリへの固定リンクが軒並み解決不能になっていた)。
  const currentDir = path.posix.dirname(currentRel);
  let resolved = path.posix.normalize(path.posix.join(currentDir, clean));
  // サイトルートを指す形を空文字（front のサイトパス）に寄せる。
  // normalize() は末尾スラッシュを保つため "./" が返ることがあり、
  // '.' だけを見ているとヘッダーのロゴリンク(href="./")や
  // 下層からのトップリンク(href="../../")が軒並み解決不能になっていた。
  if (resolved.startsWith('./')) resolved = resolved.slice(2);
  if (resolved === '.') resolved = '';
  if (resolved.endsWith('/index.html')) resolved = resolved.slice(0, -'index.html'.length);
  else if (resolved === 'index.html') resolved = '';
  return { kind: 'internal', sitePath: resolved, raw: href };
}

// pages: model 構築中に集めた {relPath, dataPage, pageId, cpt} の配列
function buildLinkRegistry(pages) {
  const registry = new Map();
  for (const p of pages) {
    const sitePath = sitePathForRel(p.relPath);
    let descriptor;
    if (p.dataPage === 'front') descriptor = { kind: 'front' };
    else if (p.dataPage === 'page') descriptor = { kind: 'page', pageId: p.pageId };
    else if (p.dataPage === 'archive') descriptor = { kind: 'archive', cpt: p.cpt };
    // data-page-variant のページは「同じ投稿の別テンプレート」であり、
    // 独立した投稿ではない。URL は /<投稿のパーマリンク>/<variant>/（functions.php の
    // add_rewrite_endpoint）なので、single とは別の descriptor にする。
    else if (p.dataPage === 'single' && p.variant) descriptor = { kind: 'variant', cpt: p.cpt, variant: p.variant };
    else if (p.dataPage === 'single') descriptor = { kind: 'single', cpt: p.cpt };
    registry.set(sitePath, descriptor);
  }
  return registry;
}

// モックのサイトパスを WordPress の URL の形に直す。
//   events/sample.html      → /events/sample/
//   about/spots/auma.html   → /about/spots/auma/
//   network/cases/          → /network/cases/
// 拡張子を落として前後にスラッシュを付けるだけ。推測は入らない。
function sitePathToWpPath(sitePath) {
  let p = (sitePath || '').replace(/\.html$/, '').replace(/^\/+|\/+$/g, '');
  return p === '' ? '/' : `/${p}/`;
}

// loopCpt: ループ項目の中を描画しているとき、そのループが指す CPT。
//
// ループの中では「どの投稿か」が周回ごとに変わる。モックには具体的な1件への
// リンクが書いてあるが（カード全体が <a> でその投稿を指す形）、それを
// 特定の投稿の URL に固定すると **全カードが同じ行き先になる**。
// 実測: /events/ /center/ /about/spots/ の一覧が全滅していた（8枚・10枚・9枚すべて同一URL）。
//
// リンク解決は「モックのパス → 特定ページの URL」として作られており、
// ループ機能とは別々に実装されて交差する箇所が設計されていなかった。
function phpForDescriptor(descriptor, loopCpt) {
  // そのループが出している CPT の詳細ページを指すリンクは、その周回の投稿へ。
  if (loopCpt && descriptor.kind === 'single' && descriptor.cpt === loopCpt) {
    return 'esc_url( get_permalink() )';
  }
  switch (descriptor.kind) {
    case 'variant':
      // 文脈の投稿が決まらない場所（固定ページ等）からの variant リンク。
      // 詳細ページと同じ「代表1件」の解決に揃える。
      return `esc_url( trailingslashit( nkk_get_single_permalink( 'nkk_${descriptor.cpt}' ) ) . '${descriptor.variant}/' )`;
    case 'front':
      return "esc_url( home_url( '/' ) )";
    case 'page':
      return `esc_url( nkk_get_page_permalink( '${descriptor.pageId}' ) )`;
    case 'archive':
      return `esc_url( get_post_type_archive_link( 'nkk_${descriptor.cpt}' ) )`;
    case 'single':
      return `esc_url( nkk_get_single_permalink( 'nkk_${descriptor.cpt}' ) )`;
    default:
      throw new Error(`phpForDescriptor: unknown kind ${descriptor.kind}`);
  }
}

// 固定href(data-acf-url の無いもの)を解決し、PHP式(例: "esc_url( home_url('/') )")を返す。
// パススルー対象(#/mailto:/tel:/外部URL)は null を返す。解決できない場合は errors に積んで
// undefined を返す(フォールバックしない。呼び出し側は undefined を「編集しない」で扱ってよいが、
// これはエラーが既に記録された結果であり、最終的に非ゼロ終了する)。
function resolveHrefExpr(page, line, href, linkRegistry, errors, loopCpt) {
  const cls = classifyHref(href, page.relPath);

  if (cls.kind === 'anchor' || cls.kind === 'scheme' || cls.kind === 'external') {
    return null;
  }

  if (cls.kind === 'unknown') {
    errors.add(page.relPath, line, `href="${href}" の形式を解決できません(相対パス/絶対パス/外部URL/#/mailto:/tel: のいずれでもありません)`);
    return undefined;
  }

  // レジストリは引くが、ループ内の一般リンクでは行き先を採用しない（下記参照）。
  // variant 判定にだけ必要なので先に引く。
  const descriptor = linkRegistry.get(cls.sitePath);

  // variant ページ（data-page-variant）へのリンクは「同じ投稿の別テンプレート」への遷移。
  //
  // モックには具体的な1件（例 events/summer-camp-apply.html）が書いてあるが、これは
  // モックを開いて申込ページへ回遊できるようにするためのもので、行き先の投稿を
  // 決めているわけではない。イベント詳細に置かれた「申し込む」は、常に
  // **そのイベント自身の申込ページ**を指す。
  //
  // 実測: ここが無かったとき href="http://hiraodai-kansatsukai-apply.html" が出ていた
  // （モックの相対パスが ACF の初期値として本番に出て、esc_url がドメイン扱いした）。
  const contextCpt = loopCpt || (page.dataPage === 'single' ? page.cpt : null);
  if (descriptor && descriptor.kind === 'variant' && descriptor.cpt === contextCpt) {
    return `esc_url( trailingslashit( get_permalink() ) . '${descriptor.variant}/' )`;
  }

  // ループ項目の中の内部リンクは、その周回の投稿へ。
  //
  // モックには具体的な1件へのリンクが書いてある（カード全体が <a> でその投稿を指す形）が、
  // ループの中では「どの投稿か」は周回が決めるので、**書いてある行き先を調べる意味がない**。
  // レジストリの中身に関わらず確定させる。書いていないページを指していても解決できる。
  //
  // 実測: この分岐が無かったとき /events/ /center/ /about/spots/ の一覧が全滅していた
  // （8枚・10枚・9枚のカードが全部同じ URL）。しかも未解決リンクだったため
  // 「行き先が無い」という別の警告に紛れて、一覧が壊れていることに気づけなかった。
  if (loopCpt) {
    return 'esc_url( get_permalink() )';
  }

  if (!descriptor) {
    const msg = `href="${href}" はモック内のどのページにも解決できません(サイトパス "${cls.sitePath || '/'}" 相当のページが存在しません)`;
    if (errors.allowUnresolvedLinks) {
      // 一時的なエスケープハッチ。
      //
      // ただし **モックの生パスをそのまま残してはいけない。**
      // "network/cases/mine.html" のような .html 付きの URL は、
      // パーマリンク設定が何であれ WordPress では必ず 404 になる。
      // 行き先が無いことと、URL の形が不正であることは別の問題であり、
      // 後者まで持ち込むと「ページを作れば直る」状態ですらなくなる。
      //
      // 解決できなくても **WordPress 形の URL は決まる**（モックのパスから機械的に導ける）。
      // その形で出しておけば、対応するページを作った時点でそのまま繋がる。
      const wpPath = sitePathToWpPath(cls.sitePath);
      errors.warn(page.relPath, line, msg + ` → WordPress 形の URL(${wpPath}) にしました。行き先はまだありません`);
      return `esc_url( home_url( '${wpPath}' ) )`;
    }
    errors.add(page.relPath, line, msg);
    return undefined;
  }

  return phpForDescriptor(descriptor, loopCpt);
}

// 固定リンク <a>（data-acf-url の無いもの）の href を解決し、EditList 用の編集を返す。
// テンプレート本体(直接PHPが実行される文脈)専用。CF7フォーム本文(文字列として保存される
// 文脈)では使えない -> lib/gen/cf7.js は resolveHrefExpr を直接使う。
function resolveFixedHref(page, hrefLoc, href, linkRegistry, errors, loopCpt) {
  const phpExpr = resolveHrefExpr(page, hrefLoc.startLine, href, linkRegistry, errors, loopCpt);
  if (!phpExpr) return null;
  return { start: hrefLoc.startOffset, end: hrefLoc.endOffset, replacement: `href="<?php echo ${phpExpr}; ?>"` };
}

module.exports = { sitePathForRel, classifyHref, buildLinkRegistry, phpForDescriptor, resolveFixedHref, resolveHrefExpr };
