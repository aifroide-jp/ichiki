'use strict';

// data-nav の内部 DOM を「テンプレート」として読み取る。
//
// v0.1 は nav の形を flat / grouped の2種類に分類し、それぞれ専用の items_wrap と
// Walker を持っていた。形を有限個サポートする作りなので、実物のデザインは必ずそれを
// 超える(実測: 4つのナビのうち適合したのは1つだけ)。その結果、語彙側でナビの
// マークアップを1形式に固定するという「変換器の都合でデザインを制約する」対処に
// 傾いた。これは設計原則1(デザインは自由、構造は宣言必須)に反するため撤回した。
//
// ここでは形を分類せず、**書かれた形をそのまま型として記録**する。Walker はその型に
// wp-admin のメニュー項目を流し込むだけになるので、ドロップダウンでもアコーディオンでも
// 何階層でも通る。一覧(data-loop)が「見本を1件書いて変換器が繰り返す」のと同じ考え方で、
// ナビだけ別扱いにする理由が無い。
//
// 項目の決め方:
//   - data-nav-item を持つ要素があれば、それが項目
//   - 無ければ nav 直下のタグ子要素が項目
// 宣言は原則不要で、レイアウトの器が項目より外側に挟まる場合(フッターの列組み等)だけ
// data-nav-item を付ける。
//
// 深さは制限しない。各深さで「子を持つ項目の型」と「子を持たない項目の型」を1つずつ
// 記録する。同じ深さで型が一致しない場合は**推測せずエラーにする**(決定的変換の原則)。
// 型が割れるのは「n件目だけ class が違う」等、テンプレートとして再現できない書き方を
// している合図なので、モック側を直す必要がある。

const MAX_DEPTH = 10;

function tagChildren(el) {
  return (el.children || []).filter((c) => c.type === 'tag');
}

function descendants(el, out = []) {
  for (const c of tagChildren(el)) {
    out.push(c);
    descendants(c, out);
  }
  return out;
}

// 構造宣言(data-*)は生成物に残さない。型を切り出すときにまとめて削除する。
// 直前の半角スペースごと消して "<div class="x" >" のような無駄を作らない。
function dataAttrRanges(page, el) {
  const out = [];
  for (const node of [el, ...descendants(el)]) {
    const loc = node.sourceCodeLocation;
    if (!loc || !loc.attrs || !node.attribs) continue;
    for (const name of Object.keys(node.attribs)) {
      if (!name.startsWith('data-')) continue;
      const aloc = loc.attrs[name];
      if (!aloc) continue;
      let start = aloc.startOffset;
      if (page.html[start - 1] === ' ') start -= 1;
      out.push({ start, end: aloc.endOffset, text: '' });
    }
  }
  return out;
}

// 絶対オフセット [start, end) を切り出しつつ、内部の範囲を置換文字列に差し替える。
function spliceRange(page, start, end, ranges) {
  let out = '';
  let cur = start;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    if (r.start < cur) continue; // 入れ子で重なった範囲は外側を優先する
    out += page.html.slice(cur, r.start) + r.text;
    cur = r.end;
  }
  return out + page.html.slice(cur, end);
}

// el のソース範囲を切り出しつつ、内部の絶対オフセット範囲を置換文字列に差し替える。
// DOM を組み直さずソースをそのまま使うので、元のマークアップがバイト単位で保たれる。
function sliceTemplate(page, el, ranges) {
  const loc = el.sourceCodeLocation;
  if (!loc) return null;
  const base = loc.startOffset;
  const whole = page.html.slice(base, loc.endOffset);
  // 置換範囲の中に入る data-* は個別に消さない(範囲ごと差し替わるため)。
  const all = [...ranges];
  for (const d of dataAttrRanges(page, el)) {
    if (!ranges.some((r) => d.start >= r.start && d.end <= r.end)) all.push(d);
  }
  let out = '';
  let cur = base;
  for (const r of all.sort((a, b) => a.start - b.start)) {
    out += whole.slice(cur - base, r.start - base) + r.text;
    cur = r.end;
  }
  out += whole.slice(cur - base);
  return out;
}

// <a href="…">文言</a> → <a href="{{URL}}"{{CURRENT}}>{{TEXT}}</a>
// href を持たない要素(フッターの見出し等)は {{TEXT}} だけになる。
//
// currentClass: data-nav-current の値（vocabulary.md 5.1）。
//   モックは現在ページのリンクにこの class を付けている（付いていないとモックを
//   開いたとき現在地が分からない）。テンプレートを1ページ分から起こす都合上、
//   **その1枚に付いていた分をそのまま焼き込むと全ページで同じ項目が現在地になる**。
//   そこで class からは取り除き、代わりに {{CURRENT}} を置いて実行時に決めさせる。
//   WordPress は current-menu-item を $item->classes に入れてくれるので推測は要らない。
function withLinkPlaceholders(page, el, currentClass) {
  const loc = el.sourceCodeLocation;
  if (!loc || !loc.startTag || !loc.endTag) return null;
  const ranges = [];
  if (loc.attrs && loc.attrs.href) {
    ranges.push({ start: loc.attrs.href.startOffset, end: loc.attrs.href.endOffset, text: 'href="{{URL}}"' });
  }

  if (currentClass) {
    const classLoc = loc.attrs && loc.attrs.class;
    const kept = (page.$(el).attr('class') || '')
      .split(/\s+/)
      .filter((c) => c && c !== currentClass)
      .join(' ');

    // **形を1つに揃える。** 現在ページのリンクだけ class 属性が増えると、
    // ウォーカーのテンプレート化が「同じ階層なのに項目ごとに形が違う」と判断して止まる
    // （実測: 型1 <a href>… / 型2 <a href class="…">… の2形になった）。
    // 他の class が残らないなら属性ごと落とし、どのリンクも同じ形にする。
    if (classLoc && kept) {
      ranges.push({ start: classLoc.startOffset, end: classLoc.endOffset, text: `class="${kept}{{CURRENT}}"` });
    } else {
      if (classLoc) {
        // class="active" だけだった → 属性ごと削る（前の空白も一緒に）
        let from = classLoc.startOffset;
        if (page.html[from - 1] === ' ') from -= 1;
        ranges.push({ start: from, end: classLoc.endOffset, text: '' });
      }
      const insertAt = loc.startTag.endOffset - 1; // ">" の直前
      ranges.push({ start: insertAt, end: insertAt, text: '{{CURRENT_ATTR}}' });
    }
  }

  ranges.push({ start: loc.startTag.endOffset, end: loc.endTag.startOffset, text: '{{TEXT}}' });
  return sliceTemplate(page, el, ranges);
}

// 項目の中の「子リストの器」。タグ子要素が2つ以上あり、最後の子がリンクを含むならそれ。
// 例: <div class="nav-item"><a>親</a><ul class="dropdown">…</ul></div> の <ul>
function childContainerOf(item) {
  const kids = tagChildren(item);
  if (kids.length < 2) return null;
  const last = kids[kids.length - 1];
  const hasLinks = last.name === 'a' || descendants(last).some((n) => n.name === 'a');
  return hasLinks ? last : null;
}

// 項目のタイトルを担う要素。子リストの外にある最初の <a>、無ければ最初のタグ子孫。
// フッターのように親が <h3> でリンクを持たない形も、これで拾える。
function titleElementOf(item, childContainer) {
  const inside = new Set(childContainer ? [childContainer, ...descendants(childContainer)] : []);
  const outside = descendants(item).filter((n) => !inside.has(n));
  return outside.find((n) => n.name === 'a') || outside[0] || null;
}

// 子を持たない項目の型。項目そのものが <a> ならそれ、そうでなければ内側の <a> を置換する。
function leafTemplateOf(page, el, currentClass) {
  if (el.name === 'a') return withLinkPlaceholders(page, el, currentClass);
  const link = descendants(el).find((n) => n.name === 'a');
  if (!link) return null;
  const lloc = link.sourceCodeLocation;
  const inner = withLinkPlaceholders(page, link, currentClass);
  if (!inner) return null;
  return sliceTemplate(page, el, [{ start: lloc.startOffset, end: lloc.endOffset, text: inner }]);
}

function mismatch(page, line, errors, depth, what, samples) {
  const list = [...samples].slice(0, 2).map((s) => s.replace(/\s+/g, ' ').trim());
  errors.add(
    page.relPath,
    line,
    `data-nav の第${depth + 1}階層で ${what} の形が項目ごとに異なるため、テンプレートとして再現できません。` +
      `同じ階層の項目は同じマークアップで書いてください(n件目だけ class を足す等は、` +
      `CSS の構造セレクタか、実際の入れ子に移してください)。\n` +
      list.map((s, i) => `      型${i + 1}: ${s}`).join('\n')
  );
}

function analyzeNavStructure(page, $, navEl, errors) {
  // data-nav-current: 現在ページを示す class（vocabulary.md 5.1）
  const currentClass = $(navEl).attr('data-nav-current') || null;
  const line = page.lineOf($(navEl));

  // --- 1. 項目要素を決める ---
  const declared = descendants(navEl).filter((n) => n.attribs && 'data-nav-item' in n.attribs);
  const topItems = declared.length > 0 ? declared : tagChildren(navEl);
  if (topItems.length === 0) {
    errors.add(page.relPath, line, 'data-nav の中に項目が1つもありません');
    return null;
  }

  // --- 2. nav の骨組みを作る ---
  // 項目が入る場所だけを {{SLOT}} に置き換え、それ以外は書かれたまま残す。
  // これにより、レイアウトの器(フッターの列組み等)はもちろん、
  // **メニュー項目ではないブロックを nav の中に置いたままにできる**。
  // 例: フッターのソーシャルは項目ごとに aria-disabled の有無が変わりメニューの型に
  // ならないが、data-nav-item を付けなければ骨組みの一部として静的に出力される。
  const runs = [];
  for (const it of topItems) {
    const loc = it.sourceCodeLocation;
    const last = runs[runs.length - 1];
    if (last && last.parent === it.parent && last.next === it) {
      last.end = loc.endOffset;
      last.count += 1;
    } else {
      runs.push({ parent: it.parent, start: loc.startOffset, end: loc.endOffset, count: 1, next: null });
    }
    // 同じ親の「次のタグ兄弟」が続けて項目なら、同じ塊として扱う
    const sibs = tagChildren(it.parent);
    runs[runs.length - 1].next = sibs[sibs.indexOf(it) + 1] || null;
  }

  const navLoc = navEl.sourceCodeLocation;
  const innerStart = navLoc.startTag.endOffset;
  const innerEnd = navLoc.endTag.startOffset;
  const slotRanges = runs.map((r) => ({ start: r.start, end: r.end, text: '{{SLOT}}' }));
  const staticRanges = dataAttrRanges(page, navEl).filter(
    (d) => d.start >= innerStart && d.end <= innerEnd && !slotRanges.some((r) => d.start >= r.start && d.end <= r.end)
  );
  const skeleton = spliceRange(page, innerStart, innerEnd, [...slotRanges, ...staticRanges]);
  const slots = runs.map((r) => r.count);

  // --- 2.5. メニュー項目そのものを集める ---
  //
  // モックには実際の項目（ラベルと行き先）が書いてある。これを拾っておけば
  // WordPress のメニューを**自動で作れる**。お客様に「外観 → メニュー」で
  // 作らせる必要が無くなる（CF7 のフォームを seed するのと同じ考え方）。
  const menuItems = [];
  (function collect(list, parentIndex) {
    for (const it of list) {
      const $it = page.$(it);
      const cc = childContainerOf(it);
      const $cc = cc ? page.$(cc) : null;

      // ラベルは「子リストの外にある見出し」から取る。
      // フッターのグループは <div><h3>見出し</h3><div>リンク群</div></div> の形で、
      // 見出しが <a> ではない。<a> だけを探すと見つからず、
      // グループ全体のテキストをラベルにしてしまい、階層も潰れていた
      // （実測: 子リンクが親として並び、リンク群が空になっていた）。
      const $self = $it.clone();
      if ($cc) $self.children().last().remove(); // 子リストを外して見出しだけ残す
      const $a = $it.is('a') ? $it : $self.find('a').first();
      const label = ($a.length ? $a.text() : $self.text()).replace(/\s+/g, ' ').trim();
      if (!label) continue;

      const idx = menuItems.length;
      menuItems.push({ label, href: ($a.length ? $a.attr('href') : '') || '', parent: parentIndex });
      if (cc) collect(page.$(cc).children().toArray(), idx);
    }
  })(topItems, -1);

  // --- 3. 深さごとに「子あり」「子なし」の型を1つずつ記録する ---
  const levels = [];
  let items = topItems;
  let depth = 0;

  while (items.length > 0 && depth < MAX_DEPTH) {
    const parents = [];
    const leaves = [];
    for (const it of items) {
      const cc = childContainerOf(it);
      if (cc) parents.push({ el: it, cc });
      else leaves.push(it);
    }

    const level = {
      parentTemplate: null,
      titleTemplate: null,
      childrenOpen: '',
      childrenClose: '',
      leafTemplate: null,
    };

    if (parents.length > 0) {
      const shapes = new Set();
      const titles = new Set();
      for (const p of parents) {
        const title = titleElementOf(p.el, p.cc);
        if (!title) {
          errors.add(page.relPath, page.lineOf($(p.el)), 'data-nav の項目にタイトルとなる要素がありません');
          return null;
        }
        const tloc = title.sourceCodeLocation;
        const cloc = p.cc.sourceCodeLocation;
        shapes.add(
          sliceTemplate(page, p.el, [
            { start: tloc.startOffset, end: tloc.endOffset, text: '{{TITLE}}' },
            { start: cloc.startOffset, end: cloc.endOffset, text: '{{CHILDREN}}' },
          ])
        );
        titles.add(withLinkPlaceholders(page, title, currentClass));
        if (!level.childrenOpen) {
          level.childrenOpen = page.html.slice(cloc.startTag.startOffset, cloc.startTag.endOffset);
          level.childrenClose = page.html.slice(cloc.endTag.startOffset, cloc.endTag.endOffset);
        }
      }
      if (shapes.size > 1) {
        mismatch(page, line, errors, depth, '子を持つ項目', shapes);
        return null;
      }
      if (titles.size > 1) {
        mismatch(page, line, errors, depth, '項目の見出し', titles);
        return null;
      }
      level.parentTemplate = [...shapes][0];
      level.titleTemplate = [...titles][0];
    }

    if (leaves.length > 0) {
      const shapes = new Set();
      for (const lf of leaves) {
        const t = leafTemplateOf(page, lf, currentClass);
        if (!t) {
          errors.add(page.relPath, page.lineOf($(lf)), 'data-nav の項目にリンク(<a>)がありません');
          return null;
        }
        shapes.add(t);
      }
      if (shapes.size > 1) {
        mismatch(page, line, errors, depth, '子を持たない項目', shapes);
        return null;
      }
      level.leafTemplate = [...shapes][0];
    }

    levels.push(level);

    const next = [];
    for (const p of parents) next.push(...tagChildren(p.cc));
    items = next;
    depth += 1;
  }

  return { kind: 'template', skeleton, slots, levels, menuItems, currentClass };
}

module.exports = { analyzeNavStructure };
