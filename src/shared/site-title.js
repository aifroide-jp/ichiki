'use strict';

// `<title>` の組み立て材料（区切り文字・サイト名・タグライン）を決める。
//
// なぜ必要か:
//   WordPress は `<title>` を wp_get_document_title() で組み立てる。区切りは
//   document_title_separator の既定値（– / en dash）なので、モックが「｜」で
//   書いていても実サイトは「–」になる。実測で3種類の不一致が出ていた:
//     1. 区切りが – になる
//     2. トップのタグラインが落ちる（blogdescription が空）
//     3. 記事タイトルに中間区画（"| お知らせ"）が混入する
//   どれも「WP に組み立てさせているのに、材料を渡していない」ことが原因。
//
// なぜ逐語の表にしないか:
//   モックの `<title>` をそのままテンプレートに焼くと、**お客様が管理画面から
//   作った新規ページを一切カバーできない**。他の全ページが「｜」なのに
//   新しい固定ページだけ「–」になる。組み立ては WP に任せ、材料を設定で渡す。
//
// 区切り文字の置き場所:
//   案件の設定（.ichiki.json の title_separator、既定 " | "）。ページごとに変わらないので
//   モックに51回書く情報ではない。モック側に宣言を足さないのは、
//   「モックの構造」ではなく「案件の体裁」だから。
//   既定値を置いても推測にならない。モックがその区切りで書かれているかを
//   verifyTitles() が毎回検査し、違えば停止する。

// 既定の区切り文字。案件ごとに .ichiki.json の title_separator で上書きする。
// **既定値を置いても推測にならない。** モックがこの区切りで書かれているかを
// verifyTitles() が毎回検査し、違えば名指しで停止するため。
const DEFAULT_SEPARATOR = ' | ';

// トップの `<title>`（= サイト名 + 区切り + タグライン）を分解する。
// 区切りが確定しているので割るだけ。タグラインが無い案件では null になる。
function splitFrontTitle(frontTitle, separator) {
  const i = frontTitle.indexOf(separator);
  if (i < 0) return { siteName: frontTitle, tagline: null };
  return { siteName: frontTitle.slice(0, i), tagline: frontTitle.slice(i + separator.length) };
}

// モックの `<title>` が案件の区切り文字とサイト名で書かれているかを検査する。
// ここを通さないと、設定と実際のモックが静かにズレる。
function verifyTitles({ separator, siteName, pages, labelOf }, errors) {
  const suffix = separator + siteName;
  for (const p of pages) {
    if (!p.title) {
      errors.add(p.relPath, 1, '<title> がありません');
      continue;
    }
    if (p.isFront) {
      if (!p.title.startsWith(siteName)) {
        errors.add(p.relPath, 1, `トップの <title> がサイト名 "${siteName}" で始まっていません: "${p.title}"`);
      }
      continue;
    }
    if (!p.title.endsWith(suffix)) {
      // どちらが正かは決められない。**両方の直し方を出す。**
      // モックが正なら .ichiki.json を直すのが1行で済む。
      // 案件の体裁が正ならモックを直す。lint L32 がモック内の不揃いを先に捕まえるので、
      // ここまで来るのは「モックは揃っているが設定と違う」場合が多い。
      errors.add(
        p.relPath,
        1,
        `<title> が .ichiki.json の title_separator と合いません\n` +
          `      期待する末尾: "${suffix}"（title_separator ${JSON.stringify(separator)} + トップの <title> から）\n` +
          `      このページ  : "${p.title}"\n` +
          `      直し方はどちらか:\n` +
          `        (a) モックの <title> を上の形に揃える\n` +
          `        (b) .ichiki.json の title_separator を実際に使っている区切りに直す`
      );
      continue;
    }
    // 中間区画の検査。
    // 詳細ページは "固有部 + 区切り + サイト名" でも
    // "固有部 + 区切り + 一覧の名前 + 区切り + サイト名" でもよい。
    // それ以外の中間区画は、投稿タイトルに混ざって管理画面まで汚す（実測: "…しました | お知らせ"）。
    const head = p.title.slice(0, -suffix.length);
    const at = head.lastIndexOf(separator);
    if (at < 0) continue; // 中間区画なし
    const middle = head.slice(at + separator.length);
    const label = labelOf ? labelOf(p) : null;
    if (!label) {
      errors.add(
        p.relPath,
        1,
        `<title> に想定外の中間区画 "${middle}" があります\n` +
          `      このページは一覧を持たないので "固有部${separator}${siteName}" の形にしてください\n` +
          `      このページ: "${p.title}"`
      );
    } else if (middle !== label) {
      errors.add(
        p.relPath,
        1,
        `<title> の中間区画が一覧ページの名前と違います\n` +
          `      一覧ページの名前: "${label}"\n` +
          `      このページ      : "${middle}"`
      );
    }
  }
}

// ページ固有部（= 投稿タイトル / ページタイトルになる部分）を取り出す。
// 区切りが確定しているので、末尾を長さで落とすだけ。候補を順に試す必要はない。
//
// 中間区画（CPT ラベル）は**あるページと無いページが混在する**。
// モックの実測: news は "記事名 | お知らせ | サイト名"、spot は "平尾台 | サイト名"。
// ラベル付きの形だけを見ていた頃は、spot の投稿タイトルが
// "平尾台 | アーバンネイチャー北九州" のまま登録されていた。
function ownTitlePart({ title, separator, siteName, label }) {
  const candidates = [];
  if (label) candidates.push(separator + label + separator + siteName);
  candidates.push(separator + siteName);
  for (const suffix of candidates) {
    if (title.endsWith(suffix)) return title.slice(0, -suffix.length);
  }
  return title;
}

module.exports = { DEFAULT_SEPARATOR, splitFrontTitle, verifyTitles, ownTitlePart };
