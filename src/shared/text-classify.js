'use strict';

// ページ内の全テキストノードを「誰が編集するか」で分類する。**唯一の実装。**
//
// 消費者は2つ:
//   - lint L20        … unclaimed を「更新対象外になる文言」として一覧に出す
//   - scan の coverage … 全テキストが必ずどれかに入ることを検証する（取りこぼしゼロの根拠）
//
// なぜ共有するか: 以前この分類を2箇所に別々に書いていて、
// scan が 127件・lint が 109件と**18件ずれたまま**、
// scan の出力は「lint L20 と同じ集合」と断言していた。
// 数字が食い違ったまま両方が正しい顔をするのが最悪の壊れ方なので、定義ごと1つにする。

const BUCKETS = ['acf', 'nav', 'cf7', 'breadcrumb', 'loop_sample', 'deco', 'unclaimed'];

// 中身がテキストとして意味を持たないタグ
const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript']);

// ACF 以外の仕組みで編集する / 変換時に捨てられる領域。
// ここを除外しないと「更新対象外の文言」レポートの過半がノイズになり、
// お客様との合意に使えなくなる（実測: 除外前は233件中153件がノイズだった）。
const MANAGED = [
  { attr: 'data-loop-sample', bucket: 'loop_sample' }, // デザイン確認用ダミー。変換器が破棄する
  { attr: 'data-nav', bucket: 'nav' }, // WP カスタムメニューで編集する
  { attr: 'data-cf7', bucket: 'cf7' }, // CF7 のフォーム定義側で編集する
  { attr: 'data-breadcrumb', bucket: 'breadcrumb' }, // 祖先は固定リンク・現在地は投稿タイトル
];

function hasAttr(ancestors, attr) {
  return ancestors.some((e) => e.attribs && Object.prototype.hasOwnProperty.call(e.attribs, attr));
}

function isDecorative(ancestors) {
  return ancestors.some(
    (e) =>
      (e.name || '').toLowerCase() === 'svg' ||
      (e.attribs &&
        (e.attribs['aria-hidden'] === 'true' ||
          Object.prototype.hasOwnProperty.call(e.attribs, 'data-deco')))
  );
}

// 優先順位は「編集できないもの・消えるもの」が先。
// 例: data-loop-sample の中に data-acf があっても、そのカードごと捨てられるので
// 「ACF で編集できる」と数えてはいけない。
function bucketOf(ancestors) {
  if (isDecorative(ancestors)) return 'deco';
  for (const m of MANAGED) if (hasAttr(ancestors, m.attr)) return m.bucket;
  if (hasAttr(ancestors, 'data-acf')) return 'acf';
  return 'unclaimed';
}

// bodyEl 配下の全テキストノードを走査し、visit({ bucket, text, line, node }) を呼ぶ。
// text は空白を1つに畳んだもの。空白のみのノードは呼ばれない。
function walkTextNodes(bodyEl, visit) {
  (function walk(node, ancestors) {
    if (!node) return;
    if (node.type === 'tag') {
      if (SKIP_TAGS.has((node.name || '').toLowerCase())) return;
      const chain = [node, ...ancestors];
      for (const c of node.children || []) walk(c, chain);
      return;
    }
    if (node.type !== 'text') return;
    const raw = (node.data || '').trim();
    if (!raw) return;
    visit({
      bucket: bucketOf(ancestors),
      text: raw.replace(/\s+/g, ' '),
      line: node.sourceCodeLocation ? node.sourceCodeLocation.startLine : null,
      node,
    });
  })(bodyEl, []);
}

// 1ページ分を集計する。counts は BUCKETS 全キーを必ず持つ。
function classifyPage(bodyEl) {
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  const unclaimed = [];
  let total = 0;
  if (bodyEl) {
    walkTextNodes(bodyEl, ({ bucket, text, line }) => {
      total++;
      counts[bucket]++;
      if (bucket === 'unclaimed') unclaimed.push({ line, text: text.slice(0, 120) });
    });
  }
  return { total, counts, unclaimed };
}

module.exports = { BUCKETS, SKIP_TAGS, walkTextNodes, classifyPage };
