'use strict';
const { testCasePages } = require('./theme-model');

// TSVにクォート規格は無いため、区切り文字(タブ)と改行はスペースに潰して1セル1行を保証する
function tsvField(v) {
  const s = String(v == null ? '' : v);
  return s.replace(/[\t\r\n]+/g, ' ');
}

function tsvRow(cols) {
  return cols.map(tsvField).join('\t');
}

// 自動判定できる種別（ACF差し替え・リンク遷移・アクセシビリティ）はここには出さない。
// L1（現場スタッフ）が目で見て判断するしかない項目だけを出す。
function renderC3Tsv(model, checkResultsByPageId, mockupBase) {
  const cases = testCasePages(model.pages);
  // 「合意したデザイン」の列は、モックが公開サイトの配下に置かれているときだけ出す
  // （ichiki publish-mockup）。置いていない案件で空の列を出すと、
  // L1 が「開けない URL がある」と思って止まる。
  const header = mockupBase
    ? ['ページ', '実際のページ', '合意したデザイン', '種別', '確認内容', '判定', '補足（NGの時のみ）']
    : ['ページ', 'URL', '種別', '確認内容', '判定', '補足（NGの時のみ）'];
  const rows = [header];

  // モック側の URL。モックはファイルのまま置くので .html が付く
  // （実サイトはパーマリンクなので形が違う。file キーから組み立てる）。
  const mockUrl = (page) => (mockupBase ? `${mockupBase}/${page.file}` : null);
  const row = (page, kind, text) =>
    mockupBase
      ? [page.title, page.liveUrl, mockUrl(page), kind, text, '', '']
      : [page.title, page.liveUrl, kind, text, '', ''];

  for (const page of cases) {
    rows.push(
      row(page, '表示確認', '見た目は「合意したデザイン」の通りに見えますか？（崩れ・文字化け・画像抜けがないか）')
    );
  }

  for (const page of cases) {
    rows.push(row(page, 'レスポンシブ', 'スマホで見て、文字や画像が重なったりはみ出したりしていませんか？'));
  }

  for (const page of cases) {
    if (!page.forms || page.forms.length === 0) continue;
    rows.push(
      row(
        page,
        'フォーム送信',
        'フォームに入力して送信すると「送信完了」の画面が表示され、担当者にメールが届きましたか？'
      )
    );
  }

  const body = rows.map(tsvRow).join('\r\n');
  return '﻿' + body;
}

function renderC3Guide() {
  return `# 確認シートの使い方

## これは何をするものか

新しくなったウェブサイトが、パソコンとスマホの両方でちゃんと表示されているか、
フォームがちゃんと動くかを、実際に画面を見ながら確認していただくためのシートです。

自動でチェックできることはすでにコンピューターで確認済みです。
このシートに載っている項目は「人の目で見ないと分からないこと」だけです。

## 手順

1. お手元の「l1-checklist.tsv」を Excel か Google スプレッドシートで開いてください。
2. 1行ずつ、「実際のページ」の欄のリンクをパソコンのブラウザで開いてください。
3. 「合意したデザイン」の欄があれば、それも別のタブで開いて、並べて見比べてください。
4. パソコンで見終わったら、同じものをスマホでも開いて見てください。
5. 「確認内容」の欄に書かれている質問を読んで、画面を見ながら判断してください。
6. 「判定」の欄に、次のいずれかを記入してください。
   - **YES**：質問の通りで問題ない
   - **一部NG**：気になるところはあるが、全く使えないわけではない
   - **NO**：明らかにおかしい、使えない
7. 「一部NG」または「NO」を選んだときは、「補足」の欄に一言でよいので、
   画面のどこがどうおかしかったかを書いてください。
   （例：「トップページの写真が表示されていない」「スマホで見ると文字がボタンにかぶっている」）

## わからない・迷ったとき

判断に迷ったときは、無理に YES にせず「一部NG」を選んで、
気づいたことを補足欄に書いておいてください。
一人で抱え込まず、制作の担当者に連絡してください。
間違えても大丈夫です。気づいたことをそのまま書いていただくのが一番助かります。

## このシートに載っていない項目について

次の項目は、すでにコンピューターで自動チェック済みです。このシートを確認していただく際は、
見ていただかなくて大丈夫です。

- 文章（ACFの文字）がちゃんと反映されているか
- ページ内のリンクが切れていないか
- アクセシビリティ（読み上げソフトなどへの対応）の簡易チェック

もし気になる点があれば、それも遠慮なく補足欄や別途連絡で教えてください。
`;
}

module.exports = { renderC3Tsv, renderC3Guide };
