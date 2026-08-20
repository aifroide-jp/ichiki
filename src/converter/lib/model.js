'use strict';

const { VALID_DATA_PAGE, CPT_PREFIX } = require('./constants');
const { analyzeField } = require('./field-extract');
const { sitePathForRel, buildLinkRegistry } = require('./link-resolve');
const { analyzeNavStructure } = require('./nav-structure');
// data-common / data-nav のページ横断バイト比較は、比較前に href/src を「mockupルート
// からのサイトパス」へ正規化する必要がある(v0.1 でパスをルート絶対から階層相対に変更した
// ため、深さによって同じリンク先でも文字列表現が変わる)。proposal/lint(L09)と同一ロジック
// を proposal/shared/site-path.js に一本化しており、ここでは二重実装しない。
const { normalizeOuterForCompare } = require('../../shared/site-path');

function outerHtml(page, el) {
  const loc = el.sourceCodeLocation;
  return loc ? page.html.slice(loc.startOffset, loc.endOffset) : null;
}

// data-common / data-nav 部分木の下に data-acf を持つ要素だけを集める（浅いスキャン用）。
// ネストした data-common / data-loop の内側は呼び出し側で除外範囲として渡す。
function collectFieldsShallow(page, $, rootEl, errors, excludeSet, linkRegistry) {
  const fields = [];
  // どの data-section の中で見つけたかを覚える。ACF の編集画面をタブで区切るのに使う
  // （acf.js）。覚えないと67フィールドが仕切りなしで1列に並ぶ。
  const walk = (el, section) => {
    if (!el || el.type !== 'tag') return;
    if (excludeSet && excludeSet.has(el)) return;
    const $el = $(el);
    const sec = $el.attr('data-section')
      ? { id: $el.attr('data-section'), label: $el.attr('data-section-label') || null }
      : section;
    if ($el.attr('data-acf') !== undefined || $el.attr('data-acf-url') !== undefined) {
      const { fields: f } = analyzeField(page, $, el, { linkRegistry }, errors);
      for (const one of f) {
        if (sec && !one.section) one.section = sec;
        // どのページから読んだかを刻む。CPT のフィールドは代表の single ページから集めて
        // archive にも single にも登録されるので、これが無いと台帳との突き合わせが
        // 「archive の台帳に single の値」を当ててしまい、値が入れ替わって見える。
        if (!one.srcRel) one.srcRel = page.relPath;
      }
      fields.push(...f);
    }
    for (const child of el.children || []) walk(child, sec);
  };
  for (const child of rootEl.children || []) walk(child, null);
  return fields;
}

// rootEl 配下で、指定した data-* 属性を持つ要素を列挙する（ネストしても内側まで探す）。
function findAll(rootEl, $, attrName) {
  const out = [];
  const walk = (el) => {
    if (!el || el.type !== 'tag') return;
    if (el.attribs && Object.prototype.hasOwnProperty.call(el.attribs, attrName)) out.push(el);
    for (const child of el.children || []) walk(child);
  };
  for (const child of rootEl.children || []) walk(child, null);
  return out;
}

// data-loop-item 配下(1個のみ想定)の子孫にある要素集合を「除外セット」として作る
// （その cpt 側で登録済みのフィールドなので、ページ独自フィールドの集計からは外す）。
function descendantsSet(el) {
  const set = new Set();
  const walk = (n) => {
    if (!n) return;
    set.add(n);
    for (const c of n.children || []) walk(c);
  };
  walk(el);
  return set;
}

// フィールド集計から外す部分木を集める。
//   data-common      : サイト共通フィールド側で登録済み
//   data-loop-item   : そのループが指す CPT 側で登録される（4.5 で名前を合流させる）
//   data-loop-sample : デザイン確認用ダミー。変換時に丸ごと捨てられる
// data-loop-sample を外し忘れると、**テンプレートのどこにも出てこないフィールドが
// ACF に登録される**（実測で発覚。L1 の管理画面に無意味な入力欄が並び、誰も気づかない）。
function excludedForFields(page, $) {
  const excluded = new Set();
  for (const attr of ['data-common', 'data-loop-item', 'data-loop-sample']) {
    for (const el of findAll(page.mainEl, $, attr)) {
      for (const n of descendantsSet(el)) excluded.add(n);
    }
  }
  return excluded;
}

// 台帳（scan）向け。rootEl **自身も含めて** フィールドを集める。
// collectFieldsShallow を包むだけで、読み取り自体は analyzeField 1つに寄せてある
// （scan が別実装を持っていた頃はデフォルト値が39件ズレていた）。
function collectFieldsIn(page, rootEl, model, errors) {
  // 除外は **rootEl の内側だけ** で数える。
  // excludedForFields はページ本体用で data-common の部分木を丸ごと外すため、
  // 共通ブロック自身のフィールドを聞かれたときに全部消えてしまう（実測: cta が空になった）。
  const excluded = new Set();
  for (const attr of ['data-common', 'data-loop-item', 'data-loop-sample']) {
    for (const el of findAll(rootEl, page.$, attr)) {
      for (const n of descendantsSet(el)) excluded.add(n);
    }
  }
  const out = [];
  const $root = page.$(rootEl);
  if ($root.attr('data-acf') !== undefined || $root.attr('data-acf-url') !== undefined) {
    out.push(...analyzeField(page, page.$, rootEl, { linkRegistry: model.linkRegistry }, errors).fields);
  }
  out.push(...collectFieldsShallow(page, page.$, rootEl, errors, excluded, model.linkRegistry));
  return out;
}

function buildModel(pages, errors) {
  const model = {
    pages,
    front: null,
    pageMap: new Map(), // pageId -> { page, fields }
    cptMap: new Map(),
    navShapes: new Map(), // cpt -> { archivePage, singlePages: [], fields, canonicalSingle }
    commonMap: new Map(), // name -> { el, page, html, fields }
    navMap: new Map(), // name -> { el, page, html }（テンプレート抽出に使う最初の出現）
    navCompare: new Map(), // "name#出現順" -> { page, html, line }（ページ間の食い違い検出用）
    forms: new Map(), // cf7 name -> { el, page }
    linkRegistry: null,
  };

  // --- 1. body 属性を確定し、ページ種別を仕分ける ---
  for (const page of pages) {
    const $ = page.$;
    const body = $('body').get(0);
    if (!body) {
      errors.add(page.relPath, 1, '<body> が見つかりません');
      continue;
    }
    const dataPage = $(body).attr('data-page');
    if (!VALID_DATA_PAGE.includes(dataPage)) {
      errors.add(page.relPath, page.lineOf($(body)), `data-page="${dataPage}" が無効です`);
      continue;
    }
    page.dataPage = dataPage;
    page.pageId = $(body).attr('data-page-id');
    page.cpt = $(body).attr('data-cpt');

    if (dataPage === 'page' && !page.pageId) {
      errors.add(page.relPath, page.lineOf($(body)), 'data-page="page" ですが data-page-id がありません');
      continue;
    }
    // data-page-variant: 同じ CPT の「もう1つのテンプレート」（vocabulary.md 1.1）。
    // 申込ページのように、投稿1件につき別 URL・別テンプレートが要る場合に使う。
    // CPT も管理画面のメニューも増えない。投稿を作れば自動で両方できる。
    page.variant = $(body).attr('data-page-variant') || null;
    if (page.variant && dataPage !== 'single') {
      errors.add(page.relPath, 1, 'data-page-variant は data-page="single" にのみ書けます');
    }

    if ((dataPage === 'archive' || dataPage === 'single') && !page.cpt) {
      errors.add(page.relPath, page.lineOf($(body)), `data-page="${dataPage}" ですが data-cpt がありません`);
      continue;
    }

    const main = $('#main-content').get(0) || $('main').get(0);
    if (!main) {
      errors.add(page.relPath, 1, '<main id="main-content"> が見つかりません');
      continue;
    }
    page.mainEl = main;

    // --- シェル（doctype〜<head>〜header / footer）を共通に任せるか、自前で持つか ---
    //
    // data-common="header" は「**サイトの**ヘッダー」を指す宣言で、共通化の条件は
    // 「全ページの半数以上で完全一致」（ichiki.md）。イベント申込ページの簡易ヘッダーは
    // 51枚中4枚しか使わないので、どうやっても common にはならない。
    // = 共通領域ではなく、そのページのもの。
    //
    // 宣言していないページは get_header()/get_footer() を呼ばず、自前の <header>/<footer>
    // ごと1枚の完結したドキュメントを出す。新しい属性は要らない（markup が既にそう言っている）。
    page.ownsShell = !$('[data-common="header"]').get(0);
    if (page.ownsShell) {
      // <head> と wp_head() は header.php にあるため、ヘッダーを自前で持つなら
      // フッターも自前でなければドキュメントが閉じられない。片方だけは成立しない。
      if ($('[data-common="footer"]').get(0)) {
        errors.add(
          page.relPath,
          page.lineOf($('[data-common="footer"]')),
          'data-common="header" が無いのに data-common="footer" があります(自前のヘッダーを持つページは <head> ごと自前になるため、フッターも自前にしてください)'
        );
        continue;
      }
      page.ownHeaderEl = $('body > header').get(0) || null;
      page.ownFooterEl = $('body > footer').get(0) || null;
      if (!page.ownHeaderEl || !page.ownFooterEl) {
        errors.add(
          page.relPath,
          1,
          'data-common="header" がありません。自前のシェルを持つページには <body> 直下の <header> と <footer> の両方が必要です'
        );
        continue;
      }
    }

    if (dataPage === 'front') {
      if (model.front) errors.add(page.relPath, 1, `data-page="front" のページが複数あります(先: ${model.front.relPath})`);
      model.front = page;
    } else if (dataPage === 'page') {
      if (model.pageMap.has(page.pageId)) {
        errors.add(page.relPath, 1, `data-page-id="${page.pageId}" が重複しています(先: ${model.pageMap.get(page.pageId).page.relPath})`);
      }
      model.pageMap.set(page.pageId, { page, fields: [] });
    } else if (dataPage === 'archive') {
      const entry = model.cptMap.get(page.cpt) || { archivePage: null, singlePages: [], fields: null };
      if (entry.archivePage) errors.add(page.relPath, 1, `data-cpt="${page.cpt}" の archive ページが複数あります(先: ${entry.archivePage.relPath})`);
      entry.archivePage = page;
      model.cptMap.set(page.cpt, entry);
    } else if (dataPage === 'single') {
      const entry = model.cptMap.get(page.cpt) || { archivePage: null, singlePages: [], fields: null };
      if (!entry.variantPages) entry.variantPages = new Map();
      if (page.variant) {
        if (entry.variantPages.has(page.variant)) {
          errors.add(page.relPath, 1, `data-cpt="${page.cpt}" の data-page-variant="${page.variant}" が重複しています`);
        }
        entry.variantPages.set(page.variant, page);
      } else {
        entry.singlePages.push(page);
      }
      model.cptMap.set(page.cpt, entry);
    }
  }

  errors.throwIfAny();

  // --- 2. リンク解決レジストリ（サイトパス→ページ種別）を先に作る ---
  model.allPages = pages;
  model.linkRegistry = buildLinkRegistry(pages.filter((p) => p.dataPage));

  // --- 3. data-common / data-nav をページ横断で集約し、内容が同一であることを検証する ---
  for (const page of pages) {
    const $ = page.$;
    for (const el of findAll($('body').get(0), $, 'data-common')) {
      const name = $(el).attr('data-common');
      const html = normalizeOuterForCompare(outerHtml(page, el), page.relPath);
      const entry = model.commonMap.get(name);
      // 各ページの data-common="header" を覚えておく。
      // header.php の素材は基準ページ1枚だが、「<header> と <main> の間に
      // 宣言の無い要素が無いか」は全ページで見る必要がある（templates.js 参照）。
      if (name === 'header') page.commonHeaderEl = el;

      if (!entry) {
        model.commonMap.set(name, { el, page, html, tag: (el.name || '').toLowerCase() });
      } else if (entry.html !== html) {
        errors.add(
          page.relPath,
          page.lineOf($(el)),
          `data-common="${name}" の内容が ${entry.page.relPath} と一致しません(vocabulary.md 4章: 全ページでバイト単位同一が必須)`
        );
      }
    }
    // 比較の単位は「値 × ページ内での出現順」。値だけでまとめてはいけない。
    // 同じメニューを複数の位置に出すのは正しい書き方(vocabulary.md 5章)で、位置ごとに
    // 見せ方が違えば内容も違う。lint L09 と同じ規則にしてある(片方だけ直すとズレる)。
    let navIndex = 0;
    // data-nav の値 → その値で使われている形の一覧（同じ内容の形は1つにまとめる）
  const pageNavShapes = model.navShapes; // このページで最初に出た同名 nav
    for (const el of findAll($('body').get(0), $, 'data-nav')) {
      const name = $(el).attr('data-nav');
      const html = normalizeOuterForCompare(outerHtml(page, el), page.relPath);
      const key = `${name}#${navIndex}`;
      navIndex += 1;

      // テンプレート抽出には最初の出現を使う
      if (!model.navMap.has(name)) model.navMap.set(name, { el, page, html });

      const entry = model.navCompare.get(key);
      if (!entry) {
        model.navCompare.set(key, { page, html, line: page.lineOf($(el)) });
      } else if (entry.html !== html) {
        errors.add(
          page.relPath,
          page.lineOf($(el)),
          `data-nav="${name}" の内容が ${entry.page.relPath}:${entry.line} と一致しません(ページ間で共通領域が食い違っています)`
        );
      }

      // 同じ値を同じページの複数の位置に置くのは**正しい書き方**。
      //
      // レスポンシブでは、同じメニューを PC 用とモバイル用で別のマークアップで
      // 出すのが普通である（実測: header__nav 25項目 と mobile-nav 26項目が同じ中身）。
      // これを別々のメニュー位置にすると、お客様が同じ項目を2箇所で管理することになり、
      // 片方だけ直せば黙って食い違う。**見せ方が2つあるだけで、メニューは1つ。**
      //
      // 形（マークアップ）はモックから機械生成できるので、同じ位置に複数の形を持たせる。
      const shapes = pageNavShapes.get(name) || [];
      if (!shapes.some((sh) => sh.html === html)) shapes.push({ el, html, page });
      pageNavShapes.set(name, shapes);
    }
    for (const el of findAll($('body').get(0), $, 'data-cf7')) {
      const name = $(el).attr('data-cf7');
      if (!model.forms.has(name)) model.forms.set(name, { el, page });
    }
  }

  errors.throwIfAny();

  // --- 4. CPT ごとのフィールド集合を確定する（複数 single がある場合は構造一致を検証） ---
  for (const [cpt, entry] of model.cptMap) {
    if (entry.singlePages.length === 0) {
      // L08 相当: 対応する single が無い data-loop はテンプレート生成時に検出してエラーにする。
      continue;
    }
    const canonical = entry.singlePages[0];
    const excluded = excludedForFields(canonical, canonical.$);
    const canonicalFields = collectFieldsShallow(canonical, canonical.$, canonical.mainEl, errors, excluded, model.linkRegistry);
    entry.fields = canonicalFields;
    entry.canonicalSingle = canonical;

    // variant は「同じ投稿の別テンプレート」なので、詳細ページと同じフィールドを持たない。
    // 構造一致は求めず、フィールドを CPT の集合へ合流させる
    // （合流させないと ACF に登録されず、variant テンプレートが常に空を出す）。
    for (const [vname, vpage] of entry.variantPages || []) {
      const vExcluded = excludedForFields(vpage, vpage.$);
      const vFields = collectFieldsShallow(vpage, vpage.$, vpage.mainEl, errors, vExcluded, model.linkRegistry);
      const known = new Set(entry.fields.map((f) => f.name));
      for (const f of vFields) if (!known.has(f.name)) entry.fields.push(f);
    }

    for (const other of entry.singlePages.slice(1)) {
      const otherExcluded = excludedForFields(other, other.$);
      const otherFields = collectFieldsShallow(other, other.$, other.mainEl, errors, otherExcluded, model.linkRegistry);
      const a = canonicalFields.map((f) => `${f.name}:${f.type}`).sort();
      const b = otherFields.map((f) => `${f.name}:${f.type}`).sort();
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        errors.add(
          other.relPath,
          1,
          `data-cpt="${cpt}" の single ページ間でフィールド構成が一致しません(${canonical.relPath}: [${a.join(',')}] / ${other.relPath}: [${b.join(',')}])。1つの CPT に対し single テンプレートは1つしか生成できません`
        );
      }
    }
  }

  // --- 4.5 一覧カードにしか出てこないフィールドを CPT に足す ---
  // 一覧のカードが詳細ページに無い要約を出すのは普通のこと
  // （実例: トップのイベントカードの「ソラランド平尾台 / 要予約」。詳細では会場がタグと
  // 概要表に分かれて入っており、この1行に当たる要素が無い）。
  // 以前はこれを禁止していたが、禁止すると「カードのためだけに詳細へ要素を足す」ことになり
  // デザインが歪む。許可して、ここで CPT のフィールド集合へ合流させる。
  // 足さないと ACF 定義に載らず、一覧テンプレートが常に空を出力してしまう。
  for (const page of pages) {
    const $ = page.$;
    const body = $('body').get(0);
    if (!body) continue;
    for (const loopEl of findAll(body, $, 'data-loop')) {
      const cpt = $(loopEl).attr('data-loop');
      const entry = model.cptMap.get(cpt);
      if (!entry || !entry.fields) continue;
      const items = (loopEl.children || []).filter((c) => c.type === 'tag' && 'data-loop-item' in (c.attribs || {}));
      if (items.length !== 1) continue;
      const known = new Set(entry.fields.map((f) => f.name));
      const itemFields = collectFieldsShallow(page, $, items[0], errors, null, model.linkRegistry);
      const itemAttrs = items[0].attribs || {};
      if (itemAttrs['data-acf'] !== undefined || itemAttrs['data-acf-url'] !== undefined) {
        const { fields } = analyzeField(page, $, items[0], { linkRegistry: model.linkRegistry }, errors);
        itemFields.push(...fields);
      }
      for (const f of itemFields) {
        if (known.has(f.name)) continue;
        known.add(f.name);
        entry.fields.push({ ...f, listOnly: true });
      }
    }
  }

  errors.throwIfAny();

  // --- 5. common(header/footer/cta等) 直下のフィールド = site-options フィールド ---
  model.siteOptionFields = [];
  const seenSiteOptionNames = new Set();
  for (const [name, entry] of model.commonMap) {
    const fields = collectFieldsShallow(entry.page, entry.page.$, entry.el, errors, null, model.linkRegistry);
    for (const f of fields) {
      if (!seenSiteOptionNames.has(f.name)) {
        seenSiteOptionNames.add(f.name);
        model.siteOptionFields.push(f);
      }
    }
    entry.fields = fields;
  }

  // --- 6. front / page の「自分自身のフィールド」（common・loop-item の中身を除く） ---
  function ownFieldsOf(page) {
    const excluded = excludedForFields(page, page.$);
    // loop-item の親要素自体(data-loop)も除外セットに含める必要はない(data-acfを持たないため)
    const fields = collectFieldsShallow(page, page.$, page.mainEl, errors, excluded, model.linkRegistry);
    // 自前シェルのページは <header>/<footer> も main の外にあるので、そこの data-acf も
    // このページのフィールドとして集める。集め漏らすと**テンプレには出るのに
    // ACF に登録されないフィールド**が生まれる（同種の取りこぼしを既に踏んでいる）。
    if (page.ownsShell) {
      for (const el of [page.ownHeaderEl, page.ownFooterEl]) {
        for (const f of collectFieldsShallow(page, page.$, el, errors, excluded, model.linkRegistry)) {
          if (!fields.some((x) => x.name === f.name)) fields.push(f);
        }
      }
    }
    return fields;
  }

  if (model.front) {
    model.front.ownFields = ownFieldsOf(model.front);
  }
  for (const entry of model.pageMap.values()) {
    entry.fields = ownFieldsOf(entry.page);
  }
  for (const entry of model.cptMap.values()) {
    if (entry.archivePage) {
      entry.archiveFields = ownFieldsOf(entry.archivePage);
    }
  }

  errors.throwIfAny();

  // --- 6.5 nav の内部構造(flat/grouped)を確定する ---
  model.navInfo = new Map();
  for (const [name, entry] of model.navMap) {
    const info = analyzeNavStructure(entry.page, entry.page.$, entry.el, errors);
    if (info) model.navInfo.set(name, info);
  }
  // 同じメニュー位置の「別の見せ方」。形ごとにウォーカーを作る。
  model.navVariants = new Map();
  for (const [name, shapes] of model.navShapes) {
    if (shapes.length < 2) continue;
    const list = [];
    shapes.forEach((sh, i) => {
      const info = analyzeNavStructure(sh.page, sh.page.$, sh.el, errors);
      if (info) list.push({ index: i, el: sh.el, info });
    });
    model.navVariants.set(name, list);
  }

  errors.throwIfAny();

  // --- 7. skip-link: data-* 宣言は無いが全ページ同一内容の定型要素。header.php に固定配置する ---
  function directBodyChild(page, matcher) {
    const body = page.$('body').get(0);
    for (const c of (body && body.children) || []) {
      if (c.type === 'tag' && matcher(c)) return c;
    }
    return null;
  }
  // 比較は正規化した値で行うが、出力(header.php)に使うのは最初に見つかったページの
  // 生HTMLのまま(既存の生成物を変えないため)。
  let skipLinkRawHtml;
  let skipLinkNormalizedHtml;
  for (const page of pages) {
    if (!page.dataPage) continue;
    const el = directBodyChild(page, (c) => c.attribs && c.attribs.class === 'skip-link');
    const rawHtml = el ? outerHtml(page, el) : null;
    const normalizedHtml = rawHtml ? normalizeOuterForCompare(rawHtml, page.relPath) : null;
    if (skipLinkRawHtml === undefined) {
      skipLinkRawHtml = rawHtml;
      skipLinkNormalizedHtml = normalizedHtml;
    } else if (skipLinkNormalizedHtml !== normalizedHtml) {
      errors.add(
        page.relPath,
        1,
        'skip-link(<a class="skip-link">)の内容が他ページと一致しません。data-common宣言はありませんが暗黙の共通要素として扱うにはページ間一致が必要です'
      );
    }
  }
  // <head> の外部リソース（Web フォント・favicon）。
  //
  // header.php は固定の雛形で <head> を組んでいるため、モックが書いている <link> を
  // 引き継がないと**丸ごと落ちる**。実測: Noto Sans JP が読み込まれず、
  // サイト全体が OS の代替書体で描画されていた。favicon も消えていた。
  // CSS だけ enqueue していたので、生成物を見ても気づきにくい。
  //
  // 共通領域と同じ扱いで、全ページ共通のものだけを拾う（ページ固有の CSS は enqueue 側の責務）。
  {
    const ref = model.front || pages.find((p) => p.dataPage);
    model.headLinks = [];
    if (ref) {
      ref.$('head link').each((_, el) => {
        const $el = ref.$(el);
        const rel = ($el.attr('rel') || '').toLowerCase();
        const href = $el.attr('href') || '';
        // ページ別 CSS は enqueue が担当するので除く。外部 CSS と favicon 系だけ持つ。
        // CSS は enqueue が担当する（外部・内部とも）。<head> に直接書かない。
        // 実測: Leaflet の CSS が center/index.html にしか無く、基準ページから拾う方式では
        // 丸ごと落ちていた。ページごとに要否が違うものは enqueue でしか正しく出せない。
        if (rel === 'stylesheet') return;
        let html = ref.$.html($el).trim();
        // モック内のファイル（favicon 等）への相対パスは、そのままだと WordPress で 404。
        // assets/ に置かれるのでテーマ URI に直す。
        if (href && !/^(https?:)?\/\//i.test(href)) {
          const file = href.replace(/^\.?\//, '');
          html = html.replace(
            `href="${href}"`,
            `href="<?php echo esc_url( get_template_directory_uri() . '/assets/${file}' ); ?>"`
          );
        }
        model.headLinks.push(html);
      });
    }
  }

  // data-loop-data: ループの投稿データを JS へ渡す宣言（vocabulary.md 3.2）。
  //
  // モックの JS が CPT のデータを必要とする場合がある（拠点マップのマーカー等）。
  // モックでは JS にべた書きするしかないが、変換後もそのままだと
  // **投稿を増やしても JS が変わらない**（実測: 一覧カードは CPT 由来で増えるのに
  // 地図のマーカーは10件で固定。しかもリンクが全部 404 だった）。
  //
  // 渡すフィールドは data-loop-fields で**明示させる**。全部渡すと不要なものまで
  // 画面のソースに出るし、どれが使われているのか読めなくなる。
  model.loopData = [];
  for (const page of pages) {
    if (!page.dataPage) continue;
    page.$('[data-loop-data]').each((_, el) => {
      const $el = page.$(el);
      const cpt = $el.attr('data-loop-data');
      const fields = ($el.attr('data-loop-fields') || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      model.loopData.push({ cpt, fields, page });
    });
  }

  // ページ内に直接書かれた <script>（処理を持つもの）。
  //
  // 以前は L25 で禁止していたが、理由が「テーマのどこに置けばいいか決まらない」で、
  // これは事実ではなかった。**<main> の中に置けばテンプレートにそのまま出力される。**
  // 消えていたのは「インラインだから」ではなく「</body> 直前がどの領域にも属さないから」。
  // 禁止ではなく運ぶことにした（パンくずが消えたのと同じ形の取りこぼし）。
  //
  // 実測: 活動拠点の地図（Leaflet・40行）とイベント一覧の絞り込み（45行）が、
  // L25 を通すために処理ごと捨てられ、空の箱とボタンだけが残っていた。
  {
    for (const page of pages) {
      if (!page.dataPage) continue;
      const $ = page.$;
      const body = $('body').get(0);
      const main = $('#main-content').get(0);
      const footer = page.ownsShell ? page.ownFooterEl : $('[data-common="footer"]').get(0);
      const after = footer && footer.sourceCodeLocation
        ? footer.sourceCodeLocation.endTag
          ? footer.sourceCodeLocation.endTag.endOffset
          : footer.sourceCodeLocation.endOffset
        : main && main.sourceCodeLocation
          ? main.sourceCodeLocation.endOffset
          : 0;
      page.trailingScripts = [];
      // body.children ではなく $('script') で全部見る。
      // パーサが <script> を body の直下に置くとは限らず、実測で children が空だった。
      void body;
      for (const node of $('script').toArray()) {
        if (node.type !== 'tag' && node.type !== 'script') continue;
        if (!node.sourceCodeLocation || node.sourceCodeLocation.startOffset < after) continue;
        if ($(node).attr('src')) continue; // 外部・内部の読み込みは enqueue が担当
        const loc = node.sourceCodeLocation;
        const inner = page.html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
        if (inner.trim()) page.trailingScripts.push(inner);
      }
    }
  }

  // 外部の <script src>（Leaflet 等）。
  // **外部ライブラリの読み込みは処理ではない**ので落としてはいけない。
  // 実測: 活動拠点の地図（Leaflet）が、読み込みごと消えて白紙になっていた。
  // ページ固有 JS は enqueue されるのに、その JS が依存するライブラリが無い状態だった。
  {
    model.externalCss = [];
    {
      const seenCss = new Set();
      for (const pg of pages) {
        if (!pg.dataPage) continue;
        pg.$('head link[rel="stylesheet"]').each((_, el) => {
          const href = pg.$(el).attr('href') || '';
          if (!/^(https?:)?\/\//i.test(href)) return;
          if (seenCss.has(href)) return;
          seenCss.add(href);
          model.externalCss.push({ href, pages: [] });
        });
      }
      for (const pg of pages) {
        if (!pg.dataPage) continue;
        for (const e of model.externalCss) {
          if (pg.$(`head link[href="${e.href}"]`).length) e.pages.push(pg);
        }
      }
    }
    model.externalScripts = [];
    const seen = new Set();
    for (const p of pages) {
      if (!p.dataPage) continue;
      p.$('script[src]').each((_, el) => {
        const src = p.$(el).attr('src') || '';
        if (!/^(https?:)?\/\//i.test(src)) return; // モック内の js は enqueue が担当
        if (seen.has(src)) return;
        seen.add(src);
        model.externalScripts.push({ src, pages: [] });
      });
      for (const e of model.externalScripts) {
        if (p.$(`script[src="${e.src}"]`).length) e.pages.push(p);
      }
    }
  }

  model.skipLinkHtml = skipLinkRawHtml || null;

  errors.throwIfAny();

  return model;
}

module.exports = { buildModel, collectFieldsIn, outerHtml, findAll, descendantsSet, sitePathForRel };
