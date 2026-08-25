'use strict';

// data-cf7-* から CF7 6.x のフォーム本文文字列を生成する(vocabulary.md 6章)。
// CF7 6.x の属性順序の制約(placeholder "…" は無引用オプションより後ろ)をここで保証する。
// data-cf7 の <a>(固定リンク)は render.js と同じ resolveFixedHref で解決/検証する。

const { EditList } = require('../edits');
const { resolveHrefExpr } = require('../link-resolve');
const { DECLARATION_ATTRS } = require('../constants');
const { TAG_TO_TYPE } = require('../../../shared/constants');

// フォーム本文の中に置かれた data-acf の値の出どころ（field_<scope>_<name> の <scope>）。
// acf.js のグループslug規則と同じ。
function scopeSlugForPage(page) {
  if (page.dataPage === 'front') return 'front';
  if (page.dataPage === 'page') return page.pageId;
  if (page.dataPage === 'single') return page.cpt;
  if (page.dataPage === 'archive') return `${page.cpt}_archive`;
  return null;
}

// 構造宣言の data-* だけを洗い出す。
// サイト自身の JS が使う data-*（例: イベント一覧のフィルタが読む data-type /
// data-category / data-target）は残す。以前は data- で始まる全部を消しており、
// 生成後にフィルタが黙って動かなくなっていた。
function dataAttrNames(el) {
  return Object.keys(el.attribs || {}).filter((k) => DECLARATION_ATTRS.has(k));
}

function buildTag(kind, name, required, classAttr, idAttr, placeholder, extra) {
  const parts = [`${kind}${required ? '*' : ''}`, name];
  // CF7 の class: オプションは**1クラスにつき1つ**書く。
  // class="a b" をそのまま class:a b と出すと、b が無引用の別オプションとして
  // 解釈されてタグがパースされない（CLAUDE.md 記載の既知の事故と同種）。
  if (classAttr) {
    for (const c of classAttr.trim().split(/\s+/)) parts.push(`class:${c}`);
  }
  if (idAttr) parts.push(`id:${idAttr}`);
  if (extra) parts.push(...extra);
  // CF7 6.x: クォート付きの値は無引用オプションより後ろに置く(placeholder は必ず最後)。
  if (placeholder) parts.push(`placeholder "${placeholder}"`);
  return `[${parts.join(' ')}]`;
}

// 選択肢の文言。value があればそれ、無ければ対応する <label> のテキスト。
//
// value は必ず生の attribs から読む。cheerio の attr('value') は
// **属性が書かれていなくてもチェックボックスに "on" を返す**（DOM の既定値を模倣する）。
// これを信じると、同意チェックの文言が "on" になって出力される（実測で踏んだ）。
function optionLabelOf($, input) {
  const raw = (input.attribs || {}).value;
  if (raw) return raw;
  // <label><input> テキスト</label> の形
  const $wrap = $(input).closest('label');
  if ($wrap.length) {
    const t = $wrap.text().trim();
    if (t) return t;
  }
  // <input id="x"> ... <label for="x"> の形
  const id = (input.attribs || {}).id;
  if (id) {
    const $for = $(`label[for="${id}"]`);
    if ($for.length) {
      const t = $for.text().trim();
      if (t) return t;
    }
  }
  return '';
}

// accept="image/jpeg,image/png" → filetypes:jpg|jpeg|png
const MIME_TO_EXT = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'application/pdf': ['pdf'],
};

function fileTypesFrom(accept) {
  if (!accept) return null;
  const exts = [];
  for (const raw of accept.split(',')) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (t.startsWith('.')) exts.push(t.slice(1));
    else if (MIME_TO_EXT[t]) exts.push(...MIME_TO_EXT[t]);
    else return null; // 知らない指定は推測しない
  }
  return exts.length ? [...new Set(exts)].join('|') : null;
}

function fieldTagFor(page, $, el, errors) {
  const tag = (el.name || '').toLowerCase();
  const $el = $(el);
  const name = $el.attr('data-cf7-field');
  const required = $el.attr('data-cf7-required') !== undefined;
  const isAcceptance = $el.attr('data-cf7-acceptance') !== undefined;
  const classAttr = $el.attr('class');
  const idAttr = $el.attr('id');
  const placeholder = $el.attr('placeholder');
  const line = el.sourceCodeLocation ? el.sourceCodeLocation.startLine : null;

  if (tag === 'select') {
    const options = [];
    const extra = [];
    const opts = $el.find('option').toArray();
    opts.forEach((opt, i) => {
      const text = $(opt).text();
      if (!text) return;
      // <option value="">選択してください</option> のような「値を持たない見出し行」。
      // これをそのまま選択肢として出すと **CF7 では選べる実選択肢になり、必須の
      // フォームが「選択してください」のままで通ってしまう**（静かに通るので気づけない）。
      // CF7 の first_as_label は先頭項目を value 無しのラベルとして出すためこれを使う。
      const isBlank = (opt.attribs || {}).value === '';
      if (isBlank && i !== 0) {
        errors.add(page.relPath, line, `data-cf7-field="${name}": value 空の <option> は先頭にしか置けません(CF7 の first_as_label は先頭1件のみ)`);
        return;
      }
      if (isBlank) extra.push('first_as_label');
      options.push(`"${text}"`);
    });
    return buildTag('select', name, required, classAttr, idAttr, placeholder, extra.concat(options));
  }

  if (tag === 'textarea') {
    return buildTag('textarea', name, required, classAttr, idAttr, placeholder);
  }

  if (tag === 'input') {
    const type = ($el.attr('type') || 'text').toLowerCase();

    if (type === 'checkbox') {
      // 同意か選択肢かは、宣言だけで決める。
      // 以前は「必須なら同意」と決め打っていたが、これは誤り。実測: 同じフォームに
      // member_optin（会員登録の希望＝選択肢・任意）と privacy（同意・必須）が並んでおり、
      // 必須かどうかでは区別できない。取り違えると
      //   選択肢→[acceptance]: チェックしないと送信できなくなる
      //   同意→[checkbox]    : 同意なしで送信できてしまう（静かに通るので気づけない）
      if (isAcceptance) {
        // CF7 の [acceptance] は既定で必須。任意なら optional を付ける。
        return required ? `[acceptance ${name}]` : `[acceptance ${name} optional]`;
      }
      const label = optionLabelOf($, el);
      if (!label) {
        errors.add(page.relPath, line, `data-cf7-field="${name}": チェックボックスの文言が取れません(value か <label> のテキストが必要です)`);
        return null;
      }
      // checked（初期チェック）は CF7 の default:<1始まりの番号> で表す。
      // 落とすと「既定でチェックが入っている」という設計が黙って消える。
      const pre = $el.attr('checked') !== undefined ? ['default:1'] : [];
      return buildTag('checkbox', name, required, classAttr, idAttr, null, pre.concat([`"${label}"`]));
    }

    if (type === 'radio') {
      errors.add(
        page.relPath,
        line,
        `data-cf7-field="${name}": ラジオボタン単体には宣言できません(選択肢の集まりなので、囲っている器に data-cf7-field を付けてください)`
      );
      return null;
    }

    if (type === 'file') {
      if ($el.attr('multiple') !== undefined) {
        errors.add(
          page.relPath,
          line,
          `data-cf7-field="${name}": multiple は Contact Form 7 のコア機能では出力できません。\n` +
            '      判断待ちの項目です。決まったら次を直してください:\n' +
            '        1) PROJECT-NOTES.md 第2章「追加プラグイン依存」に選定したプラグインを記録\n' +
            '        2) proposal/converter/lib/gen/cf7.js の fieldTagFor() に、そのプラグインのタグ書式を追加\n' +
            '        3) proposal/vocabulary.md 6.1節「ファイル欄」の multiple の記述を更新\n' +
            '      複数枚を諦める場合は、モックの multiple を外し「最大5枚」の表記も直すこと'
        );
        return null;
      }
      // CF7 の既定上限は約1MB。モックの表記（例「各10MBまで」）と食い違うと
      // 「アップロードできない」が静かに起きるため、上限は宣言を必須にする。
      const limit = $el.attr('data-cf7-limit');
      if (!limit) {
        errors.add(
          page.relPath,
          line,
          `data-cf7-field="${name}": ファイル欄には data-cf7-limit（バイト数）が必要です` +
            '(CF7 の既定は約1MB。書かないとモックの表記と食い違ったまま通ってしまいます)'
        );
        return null;
      }
      const extra = [`limit:${limit}`];
      const filetypes = fileTypesFrom($el.attr('accept'));
      if (filetypes) extra.push(`filetypes:${filetypes}`);
      return buildTag('file', name, required, classAttr, idAttr, null, extra);
    }

    if (type === 'hidden') {
      const value = $el.attr('value') || '';
      // 値は **クォート付きの値** で渡す（hidden.php: `reset( $tag->values )`）。
      // default:… は使えない。無引用オプションなので空白で切れる上に、
      // get_default_option() が sanitize_key() を通すため **日本語の値は空になる**。
      if (value.includes('"')) {
        errors.add(page.relPath, line, `data-cf7-field="${name}": hidden の値に " を含められません`);
        return null;
      }
      return `[hidden ${name} "${value}"]`;
    }

    if (['text', 'email', 'tel', 'url', 'number', 'date'].includes(type)) {
      // number / date の min・max は CF7 の min: / max: オプションに移す。
      // 落とすと入力範囲の制限が黙って消える(例: 年齢 8〜12 が何でも通るようになる)。
      const range = [];
      for (const k of ['min', 'max']) {
        const v = $el.attr(k);
        if (v !== undefined && v !== '') range.push(`${k}:${v}`);
      }
      if (range.length && !['number', 'date'].includes(type)) {
        errors.add(page.relPath, line, `data-cf7-field="${name}": input[type="${type}"] の min/max は CF7 に移せません(number か date のみ対応)`);
        return null;
      }
      return buildTag(type, name, required, classAttr, idAttr, placeholder, range);
    }
    errors.add(page.relPath, line, `data-cf7-field="${name}": input[type="${type}"] のCF7タグ変換は未対応です`);
    return null;
  }

  // 器に付いた宣言 = チェックボックス／ラジオのグループ。
  // CF7 はグループを1タグから自前のマークアップで出力するため、器ごと1タグに畳む
  // （モックと1:1にならない唯一の例外。PROJECT-NOTES.md 3 に明記）。
  const inputs = $el.find('input[type="checkbox"], input[type="radio"]').toArray();
  if (inputs.length > 0) {
    if (isAcceptance) {
      errors.add(page.relPath, line, `data-cf7-field="${name}": data-cf7-acceptance は同意1件ごとに付けます(器には付けられません)`);
      return null;
    }
    const kinds = new Set(inputs.map((i) => ($(i).attr('type') || '').toLowerCase()));
    if (kinds.size > 1) {
      errors.add(page.relPath, line, `data-cf7-field="${name}": 1つの器にチェックボックスとラジオが混在しています`);
      return null;
    }
    const kind = [...kinds][0];
    const options = [];
    const pre = [];
    for (const input of inputs) {
      const label = optionLabelOf($, input);
      if (!label) {
        errors.add(page.relPath, line, `data-cf7-field="${name}": 選択肢の文言が取れません(value か <label> のテキストが必要です)`);
        return null;
      }
      options.push(`"${label}"`);
      // checked（初期選択）は CF7 の default:<1始まりの番号>。落とすと初期選択が消える。
      if ((input.attribs || {}).checked !== undefined) pre.push(String(options.length));
    }
    const extra = pre.length ? [`default:${pre.join('_')}`] : [];
    if (kind === 'radio') {
      // CF7 のラジオは **常に必須**（modules/checkbox.php:204
      // `if ( $tag->is_required() or 'radio' === $tag->type )`）。任意のラジオは表現できない。
      if (!required) {
        errors.add(page.relPath, line, `data-cf7-field="${name}": 任意のラジオボタンは Contact Form 7 で表現できません(CF7 のラジオは常に必須になります)。必須にするか、チェックボックスかセレクトに変えてください`);
        return null;
      }
      // `radio*` は CF7 に登録されていない（checkbox / checkbox* / radio のみ）。
      // `[radio* …]` と書くとタグがパースされず素テキストで出力される。
      return buildTag('radio', name, false, classAttr, idAttr, null, extra.concat(options));
    }
    return buildTag(kind, name, required, classAttr, idAttr, null, extra.concat(options));
  }

  errors.add(page.relPath, line, `data-cf7-field="${name}": <${tag}> のCF7タグ変換は未対応です`);
  return null;
}

// data-cf7 要素の中身全体を、CF7の「フォーム」タブ本文として使えるHTML文字列に変換する。
// 戻り値: { body, varDecls }。
// 固定リンクの href 解決結果はここでは <?php ?> を埋め込めない(この文字列は
// PHPのヒアドキュメントとしてそのままCF7投稿のフォーム本文=DBの文字列値になるため、
// 実行時に評価されるPHPタグを書いても「文字列としての<?php ... ?>」がそのまま保存されて
// しまう=事実上のデッドコードになる)。そのため呼び出し側で事前に評価した変数への
// 埋め込み( "{$var}" )に置き換え、変数宣言は varDecls として別途返す。
function buildCf7FormBody(page, model, formEl, errors) {
  const $ = page.$;
  const loc = formEl.sourceCodeLocation;
  const base = loc.startTag.endOffset;
  const raw = page.html.slice(base, loc.endTag.startOffset);
  const editList = new EditList(raw);
  const varDecls = [];
  const groups = new Map();        // グループ名 -> { field, value }
  const dynamicValues = new Map(); // CF7フィールド名 -> post_slug|post_title|post_id
  const acfSlots = new Map();      // ACFフィールドキー -> 型（フォーム本文内の data-acf）
  let varSeq = 0;

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

  function visit(node) {
    if (!node || node.type !== 'tag') return;
    const attrs = node.attribs || {};
    const nloc = node.sourceCodeLocation;

    // data-cf7-group: 条件に合う投稿のときだけ出すブロック（vocabulary.md 6.2）。
    // CF7 のフォーム本文は静的な文字列なので、ここでは HTML コメントの目印だけを埋め込み、
    // 実際の出し分けは inc/cf7-dynamic.php のフィルタが表示時に行う。
    // コメントは CF7 のレンダリング結果にそのまま残るので、フィルタ側で範囲を特定できる。
    if ('data-cf7-group' in attrs) {
      const g = attrs['data-cf7-group'];
      const cond = attrs['data-cf7-group-if'] || '';
      const eq = cond.indexOf('=');
      groups.set(g, { field: cond.slice(0, eq), value: cond.slice(eq + 1) });
      addAbs(nloc.startOffset, nloc.startOffset, `<!--nkk-group:${g}-->`);
      if (nloc.endTag) addAbs(nloc.endTag.endOffset, nloc.endTag.endOffset, `<!--/nkk-group:${g}-->`);
    }

    if ('data-cf7-field' in attrs) {
      // data-cf7-value: hidden の値を投稿から入れる。フォーム本文には既定値を書かず、
      // フィルタが描画時に差し込む（フォームを1つに保つための仕組み）。
      if ('data-cf7-value' in attrs) {
        dynamicValues.set(attrs['data-cf7-field'], attrs['data-cf7-value']);
      }
      const tagText = fieldTagFor(page, $, node, errors);
      if (tagText !== null) addAbs(nloc.startOffset, nloc.endOffset, tagText);
      return;
    }

    // data-acf: フォーム本文の中の編集対象テキスト。
    //
    // CF7 のフォーム本文は**文字列として保存される**ので PHP を埋め込めない。
    // 目印だけ入れて、表示時に inc/cf7-dynamic.php のフィルタが値を差し込む
    // （data-cf7-group と同じ仕掛け）。
    //
    // これが無かったとき、フォーム内の data-acf はモックの文言がベタ書きで焼き込まれ、
    // ACF には登録されるのに編集しても何も変わらない**死んだフィールド**になっていた
    // （実測: optin_title / optin_note / submit_note の3件）。
    const acfName = attrs['data-acf'];
    if (acfName && nloc.startTag && nloc.endTag) {
      const scope = scopeSlugForPage(page);
      if (!scope) {
        errors.add(page.relPath, nloc.startLine, `data-acf="${acfName}" のフィールドキーを決められません（ページ種別が不明）`);
      } else {
        const type = attrs['data-acf-type'] || TAG_TO_TYPE[(node.name || '').toLowerCase()] || 'text';
        if (type === 'image') {
          errors.add(page.relPath, nloc.startLine, `data-acf="${acfName}": フォーム本文の中では image 型を扱えません`);
        } else {
          acfSlots.set(`field_${scope}_${acfName}`, type);
          stripAllDataAttrs(node);
          addAbs(nloc.startTag.endOffset, nloc.endTag.startOffset, `<!--nkk-acf:field_${scope}_${acfName}:${type}-->`);
          return; // 中身は差し込みで置き換わる
        }
      }
    }

    stripAllDataAttrs(node);

    if ((node.name || '').toLowerCase() === 'a' && $(node).attr('data-acf-url') === undefined) {
      const hrefLoc = nloc.attrs && nloc.attrs.href;
      if (hrefLoc) {
        const href = $(node).attr('href');
        const phpExpr = resolveHrefExpr(page, nloc.startLine, href, model.linkRegistry, errors);
        if (phpExpr) {
          varSeq += 1;
          const varName = `$nkk_cf7_link_${varSeq}`;
          varDecls.push(`${varName} = ${phpExpr};`);
          addAbs(hrefLoc.startOffset, hrefLoc.endOffset, `href="{${varName}}"`);
        }
      }
    }

    for (const c of node.children || []) visit(c);
  }

  for (const c of formEl.children || []) visit(c);

  return { body: editList.apply().trim(), varDecls, groups, dynamicValues, acfSlots };
}

// inc/seed-cf7.php: WPCF7_ContactForm::get_template()+set_properties() でフォームを作成する。
function generateSeedCf7Php(model, errors) {
  const forms = [];
  for (const [name, entry] of model.forms) {
    const body = buildCf7FormBody(entry.page, model, entry.el, errors);
    forms.push({ name, body });
    // フィルタ生成側が使えるように、フォームごとの動的情報を model に残す。
    if (!model.cf7Dynamic) model.cf7Dynamic = new Map();
    if (body.groups.size || body.dynamicValues.size || body.acfSlots.size) {
      model.cf7Dynamic.set(name, {
        groups: body.groups,
        dynamicValues: body.dynamicValues,
        acfSlots: body.acfSlots,
      });
    }
  }

  const lines = [];
  lines.push('<?php');
  lines.push('/**');
  lines.push(' * inc/seed-cf7.php');
  lines.push(' * data-cf7 から生成した Contact Form 7 定義(vocabulary.md 6章)。');
  lines.push(' * CF7 6.x では WPCF7_ContactForm::set_form() が存在しないため set_properties() を使う。');
  lines.push(' */');
  lines.push('');
  lines.push('if ( ! defined( \'ABSPATH\' ) ) { exit; }');
  lines.push('');
  lines.push('function nkk_seed_cf7_forms() {');
  lines.push('    if ( ! class_exists( \'WPCF7_ContactForm\' ) ) { return; }');
  lines.push('');
  for (const f of forms) {
    lines.push(`    if ( null === get_page_by_title( '${f.name}', OBJECT, 'wpcf7_contact_form' ) ) {`);
    for (const decl of f.body.varDecls) lines.push(`        ${decl}`);
    lines.push(`        $cf7 = WPCF7_ContactForm::get_template( array( 'title' => '${f.name}' ) );`);
    lines.push('        $cf7->set_properties( array(');
    // ヒアドキュメント(クォート無し FORM)を使い、固定リンクの解決結果である
    // 上記 $nkk_cf7_link_N 変数だけを "{$var}" 補間で展開する。それ以外はプレーンテキストとして扱う。
    lines.push('            \'form\' => <<<FORM');
    lines.push(f.body.body);
    lines.push('FORM,');
    lines.push('        ) );');
    lines.push('        $cf7->save();');
    lines.push('    }');
  }
  lines.push('}');
  lines.push('add_action( \'admin_init\', \'nkk_seed_cf7_forms\' );');
  lines.push('');
  return lines.join('\n');
}

module.exports = { generateSeedCf7Php, buildCf7FormBody };
