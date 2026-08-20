'use strict';

// モックのページから読み取れる「事実」を集める。**唯一の実装。**
//
// なぜ共有するか:
//   scan と変換器が同じモックを別々に読んでいて、実測で39件の食い違いが出た。
//   どれも scan 側の誤り（整形タグを落とす／入れ子フィールドの文字を飲み込む／
//   data-loop-sample を除外しない／改行をまたぐ属性が読めない）。
//   同じことを2回書けば必ずズレる、を実地で踏んだので1つに寄せる。
//
// ここに置くのは「モックを見れば分かること」だけ。
// PHP の生成方法や ACF のキー組み立ては変換器の仕事なので持ち込まない。

// data-nav ごとのリンク一覧
function navsOf($) {
  const out = [];
  $('[data-nav]').each((_, el) => {
    const $n = $(el);
    const links = [];
    $n.find('a[href]').each((__, a) => {
      links.push({ text: $(a).text().trim(), href: $(a).attr('href') });
    });
    out.push({ location: $n.attr('data-nav'), links });
  });
  return out;
}

// data-cf7 ごとの入力欄一覧
function formsOf($) {
  const out = [];
  $('[data-cf7]').each((_, el) => {
    const $f = $(el);
    const fields = [];
    $f.find('[data-cf7-field]').each((__, i) => {
      const $i = $(i);
      const node = $i.get(0);
      const tag = (node.tagName || node.name || '').toLowerCase();
      fields.push({
        name: $i.attr('data-cf7-field'),
        tag,
        type: $i.attr('type') || tag,
        required: $i.attr('data-cf7-required') !== undefined,
        placeholder: $i.attr('placeholder') || '',
      });
    });
    out.push({ id: $f.attr('data-cf7'), fields });
  });
  return out;
}

// 装飾として ACF 化しないもの（vocabulary.md 2.4）
function decorationOf($) {
  const out = [];
  $('[data-deco], [aria-hidden="true"]').each((_, el) => {
    const $d = $(el);
    const tag = (el.tagName || el.name || '').toLowerCase();
    const cls = ($d.attr('class') || '').split(/\s+/).filter(Boolean)[0];
    out.push({
      selector: cls ? `${tag}.${cls}` : tag,
      reason: $d.attr('data-deco') !== undefined ? 'data-deco' : 'aria-hidden="true"',
    });
  });
  return out;
}

function metaOf($) {
  return {
    title: $('title').text().trim(),
    description: $('meta[name="description"]').attr('content') || '',
  };
}

// このページが読む CSS。外部（フォント等）はそのまま、モック内は正規化する。
function cssOf($, relPath, path) {
  const out = [];
  $('link[rel="stylesheet"][href]').each((_, el) => {
    const href = $(el).attr('href');
    if (/^(https?:)?\/\//i.test(href)) {
      out.push(href);
      return;
    }
    const dir = path.posix.dirname(relPath);
    out.push(path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, href)));
  });
  return out;
}

module.exports = { navsOf, formsOf, decorationOf, metaOf, cssOf };
