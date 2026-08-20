'use strict';

const { DERIVABLE_TAGS, TAG_TO_TYPE, VALID_ACF_TYPES } = require('./constants');
const { phpRaw, phpConcat } = require('./php-util');
const { resolveHrefExpr } = require('./link-resolve');
const { normalizeAttrValue } = require('../../shared/site-path');

// data-acf / data-acf-url を持つ要素1個を解析し、
//   - ACFフィールド定義（name/type/defaultValue）
//   - テンプレート側の置換編集（EditListへ積む [start,end,replacement]）
// を1回で求める。型導出・デフォルト値抽出・置換範囲の決定はすべてここに集約する
// （vocabulary.md 2.1/2.2 の唯一の実装箇所にする＝二重管理しない）。
//
// 戻り値: { fields: [{name, type, defaultValue}], edits: [{start,end,replacement}] }
// 想定外の構造（型が導出できない・置換対象のテキストノードが複数に分裂している等）は
// errors に積んで null 相当（fields:[], edits:[]）を返す。呼び出し側は最後に errors.throwIfAny()。

// wysiwyg のデフォルト値を作る。
//
// 中身は1つの塊として ACF の default_value に入るが、そこにモック内リンクが含まれていると
// 相対パス（../contact/index.html）のまま本番に残り、WordPress では解決できない。
// 実測でこの不具合が出たため、内側の <a href> だけパーマリンクへ解決する。
// ACF 定義は PHP ソースなので、文字列連結で埋め込める。
//
// data-acf-url を持つ <a> は wysiwyg の中に書けない（別途エラーにする）。
// まとまり全体を L1 が編集するフィールドなので、その中のリンクだけ別フィールドにする
// 意味が無く、エディタ上で直接張り替えるほうが自然なため。
function wysiwygDefault(page, el, innerStart, innerEnd, opts, errors) {
  const raw = page.html.slice(innerStart, innerEnd);
  const registry = opts && opts.linkRegistry;

  const links = [];
  (function walk(n) {
    for (const c of n.children || []) {
      if (c.type !== 'tag') continue;
      if ((c.name || '').toLowerCase() === 'a') links.push(c);
      walk(c);
    }
  })(el);

  for (const a of links) {
    const attrs = a.attribs || {};
    if (attrs['data-acf-url'] !== undefined || attrs['data-acf'] !== undefined) {
      errors.add(
        page.relPath,
        a.sourceCodeLocation ? a.sourceCodeLocation.startLine : null,
        'data-acf-type="wysiwyg" の中に data-acf / data-acf-url を書くことはできません(まとまり全体を1フィールドとして編集するため。リンクはエディタ上で張り替えます)'
      );
    }
  }

  if (!registry) return raw.trim();

  const parts = [];
  let cur = innerStart;
  for (const a of links) {
    const aloc = a.sourceCodeLocation;
    if (!aloc || !aloc.attrs || !aloc.attrs.href) continue;
    const href = (a.attribs || {}).href;
    const expr = resolveHrefExpr(page, aloc.startLine, href, registry, errors);
    if (!expr) continue; // 外部URL / # / mailto: はそのまま。解決不能は errors に積み済み
    const hl = aloc.attrs.href;
    parts.push({ text: page.html.slice(cur, hl.startOffset) });
    parts.push({ text: 'href="' });
    parts.push({ php: expr });
    parts.push({ text: '"' });
    cur = hl.endOffset;
  }
  if (parts.length === 0) return raw.trim();
  parts.push({ text: page.html.slice(cur, innerEnd) });

  // 前後の空白を落とす（従来の trim() 相当）
  parts[0].text = parts[0].text.replace(/^\s+/, '');
  const last = parts[parts.length - 1];
  last.text = last.text.replace(/\s+$/, '');
  return phpRaw(phpConcat(parts));
}

function directChildren(el) {
  // <template> の中身は parse5/cheerio が root ノードで1段包む（DocumentFragment 相当）。
  // そのまま children を見ると text が見つからず「直下にテキストが無い」になる。
  const kids = el.children || [];
  if ((el.name || '').toLowerCase() === 'template' && kids.length === 1 && kids[0].type === 'root') {
    return kids[0].children || [];
  }
  return kids;
}

function significantTextNodes(el) {
  return directChildren(el).filter((c) => c.type === 'text' && (c.data || '').trim() !== '');
}

// 意味を持たない純粋な整形タグ。これらが挟まってテキストが分裂している場合は
// 「1つの編集単位が改行や強調で区切られているだけ」なので、内側まるごとを
// 1フィールドとして扱う（値は HTML を含む）。
// 日本語の見出しは <br> で改行位置を制御するのが常態であり、
// これを表現できない語彙は実用にならない（実測: index.html で6箇所）。
// <a> は行き先という別の情報を持つため、ここには含めない（未決事項1の対象のまま）。
const FORMATTING_TAGS = new Set(['br', 'strong', 'em', 'b', 'i', 'small', 'sub', 'sup', 'wbr', 'u', 'mark']);

function isFormattingOnly(el) {
  return directChildren(el).every(
    (c) =>
      c.type === 'text' ||
      (c.type === 'tag' && FORMATTING_TAGS.has((c.name || '').toLowerCase()) && isFormattingOnly(c))
  );
}

function deriveType(tag, dataAcfType) {
  if (dataAcfType !== undefined) {
    if (!VALID_ACF_TYPES.includes(dataAcfType)) return { error: `data-acf-type="${dataAcfType}" は無効です(有効値: ${VALID_ACF_TYPES.join('/')})` };
    return { type: dataAcfType };
  }
  if (DERIVABLE_TAGS.includes(tag)) {
    return { type: TAG_TO_TYPE[tag] };
  }
  return { error: `<${tag}> は型を導出できないタグのため data-acf-type が必須です` };
}

// ACF フィールドキー。acf.js の fieldToAcf() と同じ規則にする（field_<scope>_<name>）。
// **名前ではなくキーで引く。** 同名フィールドが複数グループにあると、名前で引いた場合に
// 別グループのものへ解決され、その投稿には存在しないので NULL になる。
// 実測: hero_title は spot/center/event/news の4CPTにあり、event の投稿で
// get_field('hero_title') が field_spot_hero_title を掴んで全滅していた。
// scopeSlug が無い呼び出しもある。model.js のフィールド収集は
// 「どんなフィールドがあるか」を数えるだけで、生成された PHP 断片は使わない。
// そこで例外にすると、フィールド定義を作る段階で落ちてしまう。
// 出力に使われないプレースホルダを返し、**実際にテンプレートへ書き込む経路**
// （render.js 経由）でのみ scope を必須にする。
function acfKey(scopeSlug, name) {
  return `field_${scopeSlug || '__NO_SCOPE__'}_${name}`;
}

// 値の保存先。site_options と <cpt>_archive のフィールドは、
// 表示中の投稿ではなく**専用の受け皿ページ**に保存される（acf.js の location 参照）。
// 第2引数を渡さないと ACF は「表示中の投稿」を見るので、そこには値が無い。
//
// 文字列フィールドは default_value があるので、ID を渡さなくても**それらしく表示される**。
// だが image 型は default_value を持てないので false になる。
// 実測: ロゴと一覧ページのヒーローだけが assets/ のフォールバックのままで、
// 管理画面で画像を設定しても画面に反映されなかった。文言が出ているので気づきにくい。
function ownerExpr(scopeSlug) {
  if (scopeSlug === 'site_options') return ', nkk_get_site_options_page_id()';
  if (/_archive$/.test(scopeSlug || '')) return `, nkk_get_archive_settings_page_id('${scopeSlug}')`;
  return '';
}

function phpFieldOutput(name, scopeSlug) {
  return `<?php the_field('${acfKey(scopeSlug, name)}'${ownerExpr(scopeSlug)}); ?>`;
}

// 要素1個から ACF フィールドと編集内容を抽出する。
// opts.imageFallbackPath: image型のとき assets/ 配下の静的フォールバック相対パス
function analyzeField(page, $, el, opts, errors) {
  const $el = $(el);
  const tag = (el.name || '').toLowerCase();
  const name = $el.attr('data-acf');
  const hasUrl = $el.attr('data-acf-url') !== undefined;
  const loc = el.sourceCodeLocation;
  const line = loc ? loc.startLine : null;
  const results = { fields: [], edits: [] };

  // --- data-acf（本文/画像フィールド） ---
  if (name !== undefined) {
    const explicitType = $el.attr('data-acf-type');
    const derived = deriveType(tag, explicitType);
    if (derived.error) {
      errors.add(page.relPath, line, `data-acf="${name}": ${derived.error}`);
      return results;
    }
    const type = derived.type;

    if (type === 'image') {
      if (tag !== 'img') {
        errors.add(page.relPath, line, `data-acf="${name}": data-acf-type="image" は <img> 以外では未対応です`);
        return results;
      }
      const src = $el.attr('src');
      const alt = $el.attr('alt');
      if (!src) {
        errors.add(page.relPath, line, `data-acf="${name}": <img> に src がありません`);
        return results;
      }
      const varUrl = `$${name}_url`;
      const varAlt = `$${name}_alt`;
      // src はページ階層に応じた相対パス（../ や ../../ を含む）。
      // assets/ 配下の位置に直すには、モックルートからのサイトパスに正規化してから繋ぐ。
      // 以前は先頭の "images/" を付け直すだけで ../ を無視しており、
      //   深さ1: assets/images/../images/x.jpg  → URL正規化で偶然通っていた
      //   深さ2: assets/images/../../images/x.jpg → **サイトルート /images/x.jpg** に落ちて壊れていた
      const assetPath = normalizeAttrValue(src, page.relPath);
      const fallbackUrl = `get_template_directory_uri() . '/assets/${assetPath}'`;
      const fallbackAlt = JSON.stringify(alt || '').replace(/"/g, "'");

      // 画像の在り処を残す。ACF の image 型は添付ファイル ID を要求するので
      // defaultValue には入れられないが、**seed がメディアへ登録するのに要る**。
      // 残していなかったため、seed が画像を飛ばし、メディアライブラリが空のまま
      // テンプレのフォールバックだけで表示されていた。
      // その状態だとお客様が管理画面から画像を差し替えられない（選ぶ元が無い）。
      results.fields.push({ name, type: 'image', defaultValue: null, asset: assetPath, alt: alt || '' });
      const phpBlock =
        `<?php $${name} = get_field('${acfKey(opts && opts.scopeSlug, name)}'${ownerExpr(opts && opts.scopeSlug)}); ` +
        `${varUrl} = $${name} ? $${name}['url'] : ${fallbackUrl}; ` +
        `${varAlt} = $${name} ? $${name}['alt'] : ${fallbackAlt}; ?>\n`;
      results.edits.push({ start: loc.startOffset, end: loc.startOffset, replacement: phpBlock });

      const srcLoc = loc.attrs && loc.attrs.src;
      if (!srcLoc) {
        errors.add(page.relPath, line, `data-acf="${name}": src 属性の位置が取得できません`);
        return results;
      }
      // src="..." の値部分（クォート含む）を丸ごと置換する
      const srcAttrText = page.html.slice(srcLoc.startOffset, srcLoc.endOffset);
      const eqIdx = srcAttrText.indexOf('=');
      const valueStart = srcLoc.startOffset + eqIdx + 1; // クォート開始位置の直前まで含む "=
      results.edits.push({
        start: srcLoc.startOffset,
        end: srcLoc.endOffset,
        replacement: `src="<?php echo esc_url( ${varUrl} ); ?>"`,
      });

      const altLoc = loc.attrs && loc.attrs.alt;
      if (altLoc) {
        results.edits.push({
          start: altLoc.startOffset,
          end: altLoc.endOffset,
          replacement: `alt="<?php echo esc_attr( ${varAlt} ); ?>"`,
        });
      } else {
        results.edits.push({ start: loc.startTag.endOffset - 1, end: loc.startTag.endOffset - 1, replacement: ` alt="<?php echo esc_attr( ${varAlt} ); ?>"` });
      }
    } else if (type === 'wysiwyg') {
      if (!loc.startTag || !loc.endTag) {
        errors.add(page.relPath, line, `data-acf="${name}": data-acf-type="wysiwyg" は開始・終了タグを持つ要素にのみ使用できます`);
        return results;
      }
      const innerStart = loc.startTag.endOffset;
      const innerEnd = loc.endTag.startOffset;
      const defaultValue = wysiwygDefault(page, el, innerStart, innerEnd, opts, errors);
      results.fields.push({ name, type: 'wysiwyg', defaultValue });
      results.edits.push({ start: innerStart, end: innerEnd, replacement: phpFieldOutput(name, opts && opts.scopeSlug) });
    } else if (type === 'url') {
      // <a data-acf="X" data-acf-type="url"> のような明示ケース。href/srcを対象にする。
      const targetAttr = loc.attrs && loc.attrs.href ? 'href' : loc.attrs && loc.attrs.src ? 'src' : null;
      if (!targetAttr) {
        errors.add(page.relPath, line, `data-acf="${name}": data-acf-type="url" ですが href/src 属性がありません`);
        return results;
      }
      const attrLoc = loc.attrs[targetAttr];
      const defaultValue = $el.attr(targetAttr);
      results.fields.push({ name, type: 'url', defaultValue });
      // 属性値に入るので esc_url() を通す。the_field() は生のまま出力するため、
      // 値に " が混ざると属性が壊れ、javascript: も素通りする。
      // 同じファイル内で image は既にエスケープしており、url 型だけ漏れていた。
      results.edits.push({
        start: attrLoc.startOffset,
        end: attrLoc.endOffset,
        replacement: `${targetAttr}="<?php echo esc_url( get_field('${name}') ); ?>"`,
      });
    } else {
      // text / textarea: 要素直下の「意味のある」テキストノードちょうど1個だけを対象にする。
      // 兄弟に data-deco 等の固定要素(例: sr-onlyの補助テキスト)が混在していても、
      // それらは無編集のまま温存する(=このPoCで発見した構造。vocabulary.mdは未定義)。
      const sig = significantTextNodes(el);
      if (sig.length === 0) {
        errors.add(page.relPath, line, `data-acf="${name}": 直下にテキストが見つかりません(型は${type})`);
        return results;
      }
      if (sig.length > 1) {
        // <br> 等の整形タグで区切られているだけなら、内側まるごとを1フィールドにする。
        if (isFormattingOnly(el) && loc.startTag && loc.endTag) {
          const start = loc.startTag.endOffset;
          const end = loc.endTag.startOffset;
          const defaultValue = page.html.slice(start, end).trim();
          results.fields.push({ name, type, defaultValue });
          results.edits.push({ start, end, replacement: phpFieldOutput(name, opts && opts.scopeSlug) });
          return results;
        }
        errors.add(
          page.relPath,
          line,
          `data-acf="${name}": 直下のテキストノードが${sig.length}個に分裂しています(要素間にタグが挟まる構造は未定義。vocabulary.md 未決事項1と同種の問題)`
        );
        return results;
      }
      const node = sig[0];
      const defaultValue = (node.data || '').trim();
      results.fields.push({ name, type, defaultValue });
      results.edits.push({
        start: node.sourceCodeLocation.startOffset,
        end: node.sourceCodeLocation.endOffset,
        replacement: phpFieldOutput(name, opts && opts.scopeSlug),
      });
    }
  }

  // --- data-acf-url（<a> の href。data-acf と併存可） ---
  if (hasUrl) {
    if (tag !== 'a') {
      errors.add(page.relPath, line, `data-acf-url は <a> 以外では未対応です(<${tag}>)`);
      return results;
    }
    const urlName = $el.attr('data-acf-url');
    const hrefLoc = loc.attrs && loc.attrs.href;
    if (!hrefLoc) {
      errors.add(page.relPath, line, `data-acf-url="${urlName}": href 属性がありません`);
      return results;
    }
    const defaultValue = $el.attr('href');
    results.fields.push({ name: urlName, type: 'url', defaultValue });

    // 値が空のときのフォールバックを必ず持たせる。
    //
    // href="" はブラウザが**現在ページ**として解釈するため、リンクが自分自身に戻る。
    // 実測: 42URL 中 34件でこれが起きていて、「応募するボタンを押しても同じページ」
    // という壊れ方をしていた。空文字に落ちる書き方は image 型で既に禁じており
    // （CLAUDE.md の front-page 仕様）、url 型だけ抜けていた。
    //
    // フォールバックはモックに書いてある href をパーマリンクへ解決したもの。
    // 解決できない場合はサイトトップにする（自分自身に戻るよりは害が小さい）。
    const fbExpr = resolveHrefExpr(page, line, defaultValue, opts && opts.linkRegistry, errors) || "home_url( '/' )";
    const varName = `$${urlName}`;
    results.edits.push({
      start: loc.startOffset,
      end: loc.startOffset,
      replacement: `<?php ${varName} = get_field('${acfKey(opts && opts.scopeSlug, urlName)}'${ownerExpr(opts && opts.scopeSlug)}); ?>`,
    });
    results.edits.push({
      start: hrefLoc.startOffset,
      end: hrefLoc.endOffset,
      replacement: `href="<?php echo ${varName} ? esc_url( ${varName} ) : ${fbExpr}; ?>"`,
    });
  }

  return results;
}

module.exports = { analyzeField, significantTextNodes, directChildren, deriveType };
