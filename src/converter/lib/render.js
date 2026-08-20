'use strict';

const { EditList } = require('./edits');
const { analyzeField } = require('./field-extract');
const { resolveFixedHref } = require('./link-resolve');
const { navWalkerClass } = require('./php-util');
const { DECLARATION_ATTRS } = require('./constants');

// 構造宣言の data-* だけを洗い出す。
// サイト自身の JS が使う data-*（例: イベント一覧のフィルタが読む data-type /
// data-category / data-target）は残す。以前は data- で始まる全部を消しており、
// 生成後にフィルタが黙って動かなくなっていた。
function dataAttrNames(el) {
  return Object.keys(el.attribs || {}).filter((k) => DECLARATION_ATTRS.has(k));
}

// 部分木(el 配下)を、data-* 宣言をすべて WordPress の呼び出しへ変換した文字列として描画する。
// includeSelf=true なら el 自身のタグも出力に含める(header/footer/共通セクション用)。
// includeSelf=false なら el の「中身」だけを出力する(<main> の中身をページ本体として使う場合)。
// scopeSlug: ACF フィールドキーの接頭辞（field_<scope>_<name>）。
// ACF は同名フィールドが複数グループにあると、**名前で引いたとき別グループのものに解決する**。
// 実測: hero_title は spot / center / event / news の4CPTに存在し、
// get_field('hero_title') が field_spot_hero_title を掴んで、event の投稿では NULL になっていた。
// 値が未保存のフィールドは全滅する（デフォルト値も出ない）。
// そのため出力は必ず**キー指定**にする。キーは CPT / ページごとに一意。
function renderFragment(page, model, el, includeSelf, errors, scopeSlug) {
  const loc = el.sourceCodeLocation;
  const base = includeSelf ? loc.startOffset : loc.startTag.endOffset;
  const sliceEnd = includeSelf ? loc.endOffset : loc.endTag.startOffset;
  const raw = page.html.slice(base, sliceEnd);
  const editList = new EditList(raw);

  // 呼び出し側が渡さない場合はページ種別から導く（acf.js の groupSlug と同じ規則）。
  let currentScope =
    scopeSlug ||
    (page.dataPage === 'front'
      ? 'front'
      : page.dataPage === 'page'
        ? page.pageId
        : page.dataPage === 'single'
          ? page.cpt
          : page.dataPage === 'archive'
            ? `${page.cpt}_archive`
            : null);
  // ループ項目の中を描画しているとき、そのループが指す CPT を持つ。
  let currentLoopCpt = null;

  function addAbs(start, end, replacement) {
    editList.replace(start - base, end - base, replacement);
  }

  function stripAllDataAttrs(node) {
    const nloc = node.sourceCodeLocation;
    if (!nloc || !nloc.attrs) return;
    for (const key of dataAttrNames(node)) {
      const aloc = nloc.attrs[key];
      if (!aloc) continue;
      let start = aloc.startOffset;
      const end = aloc.endOffset;
      if (page.html[start - 1] === ' ') start -= 1;
      addAbs(start, end, '');
    }
  }

  // nav の中身は theme_location 専用の Walker が丸ごと組み立てる。
  // 骨組み(器・静的ブロック)も Walker 側が持っているので items_wrap は素通しにする。
  // 同じメニュー位置でも、置かれている場所ごとに見せ方（マークアップ）が違う。
  // PC 用とモバイル用が典型。**メニューは1つ、形が複数**なので、
  // theme_location は同じまま walker だけ切り替える。
  // 形ごとのウォーカーはモックから機械生成される（nav-walker.js）。
  function buildNavCall(name, el) {
    const variants = model.navVariants && model.navVariants.get(name);
    let cls = navWalkerClass(name);
    if (variants && variants.length > 1) {
      const html = page.html.slice(el.sourceCodeLocation.startOffset, el.sourceCodeLocation.endOffset);
      const hit = variants.find(
        (v) => page.html.slice(v.el.sourceCodeLocation.startOffset, v.el.sourceCodeLocation.endOffset) === html
      );
      if (hit && hit.index > 0) cls = `${navWalkerClass(name)}_${hit.index + 1}`;
    }
    return (
      `<?php wp_nav_menu( array( 'theme_location' => '${name}', 'container' => false, ` +
      `'items_wrap' => '%3$s', 'walker' => new ${cls}(), 'fallback_cb' => false ) ); ?>`
    );
  }

  function visit(node) {
    if (!node || node.type !== 'tag') return;
    const attrs = node.attribs || {};
    const nloc = node.sourceCodeLocation;
    const line = nloc ? nloc.startLine : null;

    // data-loop-sample: デザイン確認用ダミー。丸ごと破棄する(vocabulary.md 3章)。
    if ('data-loop-sample' in attrs) {
      addAbs(nloc.startOffset, nloc.endOffset, '');
      return;
    }

    // data-cf7: フォーム全体を CF7 ショートコードに置換する(vocabulary.md 6章)。
    if ('data-cf7' in attrs) {
      const name = attrs['data-cf7'];
      // <form> そのものは CF7 が出すので、モックが <form> に付けていた class / id は
      // 引き継がないと消える（実測: apply-wrap が生成物に存在せず、申込フォームの
      // レイアウト指定が丸ごと効かなくなっていた）。
      // CF7 のショートコードは html_class / html_id を受け取るのでそれで渡す。
      const sc = [`contact-form-7 title="${name}"`];
      if (attrs.class) sc.push(`html_class="${attrs.class}"`);
      if (attrs.id) sc.push(`html_id="${attrs.id}"`);
      addAbs(nloc.startOffset, nloc.endOffset, `<?php echo do_shortcode( '[${sc.join(' ')}]' ); ?>`);
      return;
    }

    // ネストした data-common (例: cta-band): テンプレートパーツ呼び出しに置換する。
    if ('data-common' in attrs) {
      const name = attrs['data-common'];
      addAbs(nloc.startOffset, nloc.endOffset, `<?php get_template_part( 'template-parts/common-${name}' ); ?>`);
      return;
    }

    // data-breadcrumb: パンくず。祖先の項目はモックに書かれた固定リンクのまま
    // （リンク解決は通常の <a> 処理が行う）、末尾の「現在地」だけを動的にする。
    // 現在地はリンクを持たない項目として書かれているので、そこから機械的に決まる。
    // ここを固定のままにすると、CPT詳細テンプレートが1件目の名前を全件で出す。
    if ('data-breadcrumb' in attrs) {
      const items = [];
      (function collect(n) {
        for (const c of n.children || []) {
          if (c.type !== 'tag') continue;
          if ((c.name || '').toLowerCase() === 'li') items.push(c);
          else collect(c);
        }
      })(node);
      const current = [...items].reverse().find((li) => !(li.children || []).some((c) => c.type === 'tag' && c.name === 'a'));
      if (!current) {
        errors.add(page.relPath, line, 'data-breadcrumb にリンクを持たない項目(現在地)がありません');
        return;
      }
      const cloc = current.sourceCodeLocation;
      addAbs(cloc.startTag.endOffset, cloc.endTag.startOffset, '<?php the_title(); ?>');
    }

    // <template data-acf="…">: **フィールドは作るが出力しない。**
    //
    // 画面に出ないがお客様が編集する値（地図の緯度経度、並び順、外部システムのID等）を
    // 宣言するための書き方。<template> は HTML 標準で描画されないので、
    // **モックとして開いても何も出ない**。新しい属性を足すより素直だと判断した。
    // 型は導出できないので data-acf-type が必須になる（L05 がそのまま効く）。
    if ((node.name || '').toLowerCase() === 'template' && 'data-acf' in attrs) {
      analyzeField(page, page.$, node, { linkRegistry: model.linkRegistry, scopeSlug: currentScope }, errors);
      addAbs(nloc.startOffset, nloc.endOffset, '');
      return;
    }

    stripAllDataAttrs(node);

    // data-nav: 中身を丸ごと wp_nav_menu() 呼び出しに置換する(実際のURL/文言はwp-adminの
    // メニュー設定に委ねる。ichiki.md「nav要素はWPカスタムメニューへ変換する」と整合)。
    if ('data-nav' in attrs) {
      const name = attrs['data-nav'];
      const navInfo = model.navInfo.get(name);
      if (!navInfo) {
        errors.add(page.relPath, line, `data-nav="${name}" の内部構造を解析できなかったため出力できません`);
        return;
      }
      addAbs(nloc.startTag.endOffset, nloc.endTag.startOffset, buildNavCall(name, node));
      return;
    }

    // data-loop: WP_Query ループへ置換する。data-loop-item を1個だけ残し、前後に
    // クエリの開始/終了を挿入する。data-loop-sample の兄弟は通常の再帰で破棄される。
    if ('data-loop' in attrs) {
      const cpt = attrs['data-loop'];
      const order = attrs['data-loop-order'] || 'date_desc';
      const count = attrs['data-loop-count'] || '-1';
      const cptEntry = model.cptMap.get(cpt);
      if (!cptEntry || !cptEntry.canonicalSingle) {
        errors.add(page.relPath, line, `data-loop="${cpt}" に対応する data-page="single" data-cpt="${cpt}" のページが存在しません(L08相当)`);
        return;
      }
      const items = (node.children || []).filter((c) => c.type === 'tag' && 'data-loop-item' in (c.attribs || {}));
      if (items.length !== 1) {
        errors.add(page.relPath, line, `data-loop="${cpt}" 直下の data-loop-item が${items.length}個です(ちょうど1個である必要があります)`);
        return;
      }
      const item = items[0];
      const orderMap = { date_desc: ['date', 'DESC'], date_asc: ['date', 'ASC'], menu_order: ['menu_order', 'ASC'] };
      const pair = orderMap[order];
      if (!pair) {
        errors.add(page.relPath, line, `data-loop-order="${order}" は無効です(date_desc/date_asc/menu_orderのいずれか)`);
        return;
      }
      const countNum = Number(count);
      if (!Number.isInteger(countNum)) {
        errors.add(page.relPath, line, `data-loop-count="${count}" は整数である必要があります`);
        return;
      }
      // data-loop-repeat: 同じ並びを N 周ぶん出す。
      // 無限マーキー（CSS で translateX(-50%) して繋ぐ形）は、DOM に2周ぶんの
      // カードが無いと繋がらない。モックには複製が直接書かれているが、変換後は
      // 実データが1周ぶん出るだけなので、宣言が無いと生成物だけが途切れる
      // （モックを見ても気づけない壊れ方。設計原則4）。
      // 2周目以降は読み上げ・タブ移動から外す（同じ項目が複数回読まれるのを防ぐ）。
      const repeatRaw = attrs['data-loop-repeat'] || '1';
      const repeat = Number(repeatRaw);
      if (!Number.isInteger(repeat) || repeat < 1) {
        errors.add(page.relPath, line, `data-loop-repeat="${repeatRaw}" は1以上の整数である必要があります`);
        return;
      }

      const qv = `$nkk_loop_${cpt}`;
      const rv = `$nkk_rep_${cpt}`;
      const query =
        `${qv} = new WP_Query( array( 'post_type' => 'nkk_${cpt}', 'posts_per_page' => ${countNum}, ` +
        `'orderby' => '${pair[0]}', 'order' => '${pair[1]}' ) );`;

      let openPhp;
      let closePhp;
      if (repeat === 1) {
        openPhp = `<?php ${query} if ( ${qv}->have_posts() ) : while ( ${qv}->have_posts() ) : ${qv}->the_post(); ?>`;
        closePhp = `<?php endwhile; wp_reset_postdata(); endif; ?>`;
      } else {
        openPhp =
          `<?php ${query} for ( ${rv} = 0; ${rv} < ${repeat}; ${rv}++ ) : if ( ${qv}->have_posts() ) : ` +
          `while ( ${qv}->have_posts() ) : ${qv}->the_post(); ?>`;
        closePhp = `<?php endwhile; ${qv}->rewind_posts(); endif; endfor; wp_reset_postdata(); ?>`;
        // 2周目以降の項目に aria-hidden / tabindex を足す（開始タグの末尾に差し込む）
        const st = item.sourceCodeLocation.startTag;
        const selfClosing = page.html[st.endOffset - 2] === '/';
        const insertAt = st.endOffset - (selfClosing ? 2 : 1);
        addAbs(insertAt, insertAt, `<?php if ( ${rv} > 0 ) echo ' aria-hidden="true" tabindex="-1"'; ?>`);
      }

      addAbs(item.sourceCodeLocation.startOffset, item.sourceCodeLocation.startOffset, openPhp);
      addAbs(item.sourceCodeLocation.endOffset, item.sourceCodeLocation.endOffset, closePhp);
      // ループ項目の中のフィールドは、そのループが指す CPT のグループに属する。
      // 一覧ページ自身のスコープ（<cpt>_archive 等）とは別なので切り替える。
      const outerScope = currentScope;
      const outerLoopCpt = currentLoopCpt;
      currentScope = attrs['data-loop'];
      currentLoopCpt = attrs['data-loop'];
      for (const c of node.children || []) visit(c);
      currentScope = outerScope;
      currentLoopCpt = outerLoopCpt;
      return;
    }

    const hasAcf = 'data-acf' in attrs;
    const hasAcfUrl = 'data-acf-url' in attrs;
    let skipRecurse = false;

    if (hasAcf || hasAcfUrl) {
      const { fields, edits } = analyzeField(page, page.$, node, { linkRegistry: model.linkRegistry, scopeSlug: currentScope }, errors);
      for (const e of edits) addAbs(e.start, e.end, e.replacement);
      const acfField = fields.find((f) => f.name === attrs['data-acf']);
      if (acfField && (acfField.type === 'wysiwyg' || acfField.type === 'image')) skipRecurse = true;
    }

    // <a> の href は固定リンクとして解決する。
    //
    // data-acf-url があるときだけ analyzeField が href を書き換える。無いときは
    // ここで解決する。**data-acf（ラベル）を持つ <a> も対象**であることに注意:
    // 以前はこれが else if で分岐しており、「ラベルだけ ACF 化したリンク」の href が
    // モックの相対パスのまま出力されていた（実測: href="summer-camp-apply.html" が
    // そのまま残り、ブラウザが http://summer-camp-apply.html と解釈していた）。
    if ((node.name || '').toLowerCase() === 'a' && !hasAcfUrl) {
      const hrefLoc = nloc.attrs && nloc.attrs.href;
      if (hrefLoc) {
        const href = page.$(node).attr('href');
        const edit = resolveFixedHref(page, { ...hrefLoc, startLine: line }, href, model.linkRegistry, errors, currentLoopCpt);
        if (edit) addAbs(edit.start, edit.end, edit.replacement);
      }
    }

    if (!skipRecurse) {
      for (const c of node.children || []) visit(c);
    }
  }

  if (includeSelf) {
    // ルート要素は「その要素ごと出す」ための入口であって、置換の対象ではない。
    // ここで visit(el) を呼ぶと data-common のルートが共通領域として再帰処理され、
    // header/footer が get_template_part() に置き換わって中身が消える（実測）。
    //
    // ただしルートが <nav data-nav> の場合だけは置換が必要。
    // これを漏らすと、モバイルナビがモックのマークアップのまま固定出力され、
    // 管理画面で編集しても変わらない状態になる（属性だけ消えるので気づきにくい）。
    const rootAttrs = el.attribs || {};
    if ('data-nav' in rootAttrs && el.sourceCodeLocation && el.sourceCodeLocation.endTag) {
      stripAllDataAttrs(el);
      addAbs(
        el.sourceCodeLocation.startTag.endOffset,
        el.sourceCodeLocation.endTag.startOffset,
        buildNavCall(rootAttrs['data-nav'], el)
      );
    } else {
      stripAllDataAttrs(el);
      for (const c of el.children || []) visit(c);
    }
  } else {
    for (const c of el.children || []) visit(c);
  }

  return editList.apply();
}

module.exports = { renderFragment };
