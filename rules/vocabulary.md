# モックアップ制約語彙 v0.1（草案）

Ichiki の Phase0（mockup → acf-map.yaml）から**推測を排除**し、Phase1（→ WordPress）を
AI の自由記述ではなく**決定的な変換**にするための、モックアップ側の記述規約。

この1枚が lint ルールと制約プロンプトの共通の親になる。二重管理しない。

---

## 0. 設計原則

1. **デザインは自由、構造は宣言必須。** 見た目（色・レイアウト・雰囲気）は主観なので人がモックで合意する。
   構造（何がACF化されるか・何がCPTか・どこが共通か）は客観なので機械が検査する。
2. **推測しない。** 現行 Phase0 は祖先探索・クラス名の部分一致でセクション名や hero/main を推測しており、
   ichiki.md 自身が「人手レビュー対象」と認めている。宣言があれば推測は発生しない。
3. **エスケープハッチを作らない。** 変換器がカバーできない入力は**エラーで停止**する。
   AI へのフォールバックを許すと、決定的な部分と非決定的な部分が混ざって検証不能になる。
4. **同じものを2回以上書かない。** 位置依存の class（n番目だけ違う）や重複したマークアップは、
   **1件を型として繰り返す変換に耐えない**。静的HTMLとしては正しい書き方でも、テンプレート化した
   瞬間に「1件目の形が全件に適用される」か「重複が消える」かのどちらかになる。CSS の構造セレクタ、
   実際の入れ子、または変換器側の繰り返し指定に寄せること。
   - 実測: `fp-u44`（2番目の見出しだけ margin）、`.nav-sub`（11件中10件だけ class＝実は第3階層）、
     カルーセルの複製カード（同じカードが2周ぶん書いてある）の3件が、いずれも変換で詰まった。
     前2件はモック側を直して解決。3件目はモックでは直せない（減らすと見た目が変わる）ため
     `data-loop-repeat` を用意した（3節）。
5. **属性で宣言し、class は使わない。** class は CSS の持ち物。構造宣言を class に混ぜると、
   デザイン変更が構造を壊す。`data-*` なら CSS に一切影響しない。
   - 例外的に既存モックは `.bg-overlay` `.deco-line` `.pattern-dots` という
     **CSSを持たない純粋な意味マーカー**を既に使っている（実測: 定義ゼロで使用のみ）。
     本語彙はこの既存慣行を `data-*` に移設・拡張したものであって、新発明ではない。

---

## 1. ページ宣言

すべての HTML は `<body>` に**必ず** `data-page` を持つ。

```html
<body data-page="front">                        <!-- front-page.php -->
<body data-page="page" data-page-id="about_strategy">  <!-- page-<slug>.php -->
<body data-page="archive" data-cpt="spot">      <!-- archive-nkk_spot.php -->
<body data-page="single" data-cpt="spot">       <!-- single-nkk_spot.php -->
```

| 属性 | 必須 | 値 |
|---|---|---|
| `data-page` | ○ | `front` / `page` / `archive` / `single` |
| `data-page-id` | `page` のみ○ | ASCII小文字・数字・`_`。ファイルパス由来（`about/strategy.html` → `about_strategy`、`index.html` は畳む） |
| `data-cpt` | `archive`/`single` のみ○ | CPT のスラッグ。`nkk_` 接頭辞は変換器が付ける |

**これが本語彙の最重要点。** 現行手法は「セクション構成が完全一致するページが2件以上あるか」で
CPT を推定しており、インスタンスが1件しかない CPT（`nkk_photo` / `nkk_network`）は
**原理的に検出不可能**だった。宣言にすれば1件でも検出できる。
また、CPT と同じレイアウト語彙を使う単発固定ページとの取り違えも起きない。

---

## 2. フィールド宣言（ACF化）

編集対象の要素に `data-acf` を付ける。**付いていない要素は更新対象外**（＝固定文言）。

```html
<h1 data-acf="hero_title">都市と自然、近いからこそおもしろい。</h1>
<p  data-acf="hero_lead">北九州の自然を、もっと身近に。</p>
<img data-acf="hero_image" src="../images/index/hero.jpg" alt="皿倉山からの眺望">
```

### 2.1 型は省略可（タグから決定的に導出）

| タグ | 導出される型 |
|---|---|
| `h1`〜`h6` | `text` |
| `p`, `li`, `dd`, `td`, `span` | `textarea` |
| `img` | `image` |
| `a` | `text`（リンクテキスト。href は 2.2 の `data-acf-url`） |
| その他（`div` / `section` 等） | **導出しない → `data-acf-type` 必須** |

導出と違う型にしたいときだけ明示する。明示が常に優先。

```html
<p data-acf="fee_note" data-acf-type="text">無料</p>
<div data-acf="body" data-acf-type="wysiwyg"><h3>…</h3><p>…</p></div>
```

有効な型: `text` / `textarea` / `wysiwyg` / `url` / `image`
（ichiki.md の型マッピングに準拠。ACF PRO 専用型は使わない）

### 2.2 リンク

`<a>` はテキストと URL が別物なので属性を分ける。

```html
<a href="../contact/" data-acf-url="cta_link" data-acf="cta_label">お問合せはこちら</a>
```

- `data-acf-url` → `url` 型フィールド（`href` が値）
- `data-acf` → リンクテキストのフィールド（型導出は `text`）
- 片方だけでもよい（固定リンク＋可変ラベル、等）

**`data-acf-url` の無い `<a>` は固定リンク**として、変換器が href をパーマリンクへ機械的に解決する。
モック内ファイルへの相対パス（`../about/spots/auma.html`）は `data-page-id` / `data-cpt` から
一意に解決できる。外部URL・`#` アンカー・`mailto:` はそのまま通す。

> 実測メモ: 既存モックは `about/spots/auma.html` で href 94本のうち acf-map.yaml が拾っているのは
> nav 配下の51本のみ。残る43本（パンくず・カード・本文中・CTA）は Phase0 に一度も現れず、
> 下流のどのゲートでも検査されていない。本節はこの穴を塞ぐためにある。

#### `<a>` 以外の URL 属性

`data-acf-type="url"` は **`href` と `src` の両方**を対象にできる。`<a>` に限らない。

```html
<iframe data-acf="map_src" data-acf-type="url" src="https://maps.google.com/…"></iframe>
```

- 対象にできるのは `href` / `src` の2属性だけ。どちらも持たない要素に付けると停止する（L06）
- `data-acf-url` は `<a>` 専用（リンクテキストと対で持つための書き方のため）
- 出力は `esc_url()` を通す。属性値に入るので、値に `"` が混ざっても壊れない

`<form action>` のような他の URL 属性は未対応。必要になったら変換器を拡張する
（推測で通さず停止する）。

### 2.3 命名規則

- `{セクション}_{種別}` ＋ 同種が複数あるときだけ `_{連番}`（例: `hero_title`, `features_icon_1`）
- ASCII 小文字・数字・アンダースコアのみ。**数字始まり禁止**（PHP変数・ACFキーになるため）
- **同一スコープ内で重複禁止。** スコープはページ本体と `data-loop-item` ごとに分かれる。
  ループ項目のフィールド名は「そのループが指す CPT の詳細ページ」の名前空間に属するため、
  ページ本体や別 CPT のループと同名になるのは正しい（実測: `index.html` に spot / center /
  event / news の4ループがあり `hero_title` が4回出る）
- 意味ベースの名前を人（AI）が書く。**機械命名→意味名のリネーム工程と `field-map.json` は本語彙では不要**

### 2.4 装飾要素

`aria-hidden="true"` の要素、および `data-deco` を持つ要素は ACF 化しない（ichiki.md の③タブ相当）。

```html
<div class="hero-wave" data-deco aria-hidden="true"><svg>…</svg></div>
```

---

## 2.5 セクション宣言

`<section>` には `data-section` を付ける。acf-map.yaml の `sections[].id` になる。

```html
<section data-section="spot_detail" class="section section--white">…</section>
```

- `data-common` を持つ section には不要（common 側に回るため）
- 値は ASCII 小文字・数字・`_`

### 編集画面のタブ名（`data-section-label`）

`data-section` は **ACF の編集画面をタブで区切る**のに使われる。
タブ名は `data-section-label` で指定する。

```html
<section data-section="venue" data-section-label="会場・アクセス">
```

- **省略できる。** 書かなければ `data-section` の値（ASCII）がそのままタブ名になる
- **日本語を書いてよい**（L13 の例外。識別子ではなく画面に出る文言のため）
- 見出しテキストからは**推測しない**。見出しの無いセクションで破綻するうえ、
  何が出るか書いた人に予測できない

> 実測: タブを入れる前は `nkk_event` の67フィールドが仕切りなしで1列に並んでいた。
> L1 が検収でこれを上から見るのは現実的でない。
> `tab` は ACF 無料版に同梱されている（6.8.4 で確認）。

**なぜ必要か（実測で判明）**: v0.1 はフィールドだけ宣言させ、セクションを宣言させていなかった。
その結果、制約モックの `<section>` が持つのは `section--white` / `section--gray` という
レイアウト用クラスだけになり、KNOWN-LIMITATIONS の根本原因メモが既存モックについて指摘していた
「セクション名が CSS クラス名由来で意味を持たない」問題を**そのまま再生産していた**。

フィールド名の接頭辞からの導出も不可能である。実測: `spots/auma.html` の `spot_detail` セクションは
`overview_body` / `season_note` / `related_label` / `address` / `fee` / `hours` と
6種類の接頭辞が混在しており、共通接頭辞が存在しない。

## 2.6 文中にリンクを含む文

リンクだけを宣言すると、**前後の地の文が未宣言のまま残る**。

```html
<!-- NG: 「詳しくは」「をご覧ください。」が編集対象から漏れる -->
<p>詳しくは<a data-acf="link_label" data-acf-url="link_url">こちら</a>をご覧ください。</p>

<!-- OK: 文ごと1フィールドにする（wysiwyg なので <div>。2.7節） -->
<div data-acf="note" data-acf-type="wysiwyg">詳しくは<a href="../contact/">こちら</a>をご覧ください。</div>
```

- **wysiwyg の中に `data-acf` / `data-acf-url` は書けない**（L23）。まとまり全体を1つの
  フィールドとして L1 が編集するため、内側だけ別フィールドにする意味が無い。
  リンクはエディタ上で張り替える
- **wysiwyg の中の固定リンクは変換器がパーマリンクへ解決する。** ACF 定義は PHP ソースなので、
  デフォルト値に文字列連結で埋め込む

```php
'default_value' => '<p>詳しくは<a href="' . esc_url( nkk_get_page_permalink( 'contact' ) ) . '">こちら</a>をご覧ください。</p>',
```

> 実測: これを実装するまで、モックの相対パス（`../contact/index.html`）が
> そのまま ACF のデフォルト値に入っていた。WordPress では解決できないパスであり、
> モック側を見ても気づけない。

## 2.7 wysiwyg は `<div>` に書く（L31）

**`data-acf-type="wysiwyg"` を `<p>` に宣言できない。**

ACF の wysiwyg は値を `<p>` で包んで出力する。`<p>` の中に置くと
`<p class="x"><p>本文</p></p>` という不正な入れ子になり、HTML パーサは内側の `<p>` を
見た時点で外側を閉じる。結果、**class を持つ要素が空になり CSS が本文に当たらない。**

```html
<!-- NG -->
<p class="note" data-acf="apply_note" data-acf-type="wysiwyg">…</p>

<!-- OK -->
<div class="note" data-acf="apply_note" data-acf-type="wysiwyg">…</div>
```

- **同じフィールド名を別の型で宣言しない。** ACF のフィールドは1つなので型も1つに決まり、
  食い違えば片方の宣言箇所が壊れる。スコープ（CPT / ページ / ループの対象 CPT）が
  違えば別フィールドなので対象外
- **wysiwyg のフィールドを `p` 要素セレクタで整形しない。** `<div>` になるので当たらない

> 中身が `<br>` `<strong>` などの文字装飾だけなら wysiwyg は要らない（textarea で通る）。
> wysiwyg が要るのは 2.6 節のように内側にタグ構造を持つとき。
>
> 実測: 生成サイトで `apply_note` / `venue_intro` / `optin_note` / `submit_note` /
> `event_meta` の5件がこの形だった。文字は画面に出るため目視では気づけず、
> 「class の付いた要素が空」という形でしか現れない。

---

## 3. 繰り返し（一覧ループ）

`data-page="archive"` および一覧セクションで使う。

```html
<div data-loop="spot" data-loop-order="date_desc" data-loop-count="12">
  <article data-loop-item>              <!-- ← これがテンプレート。ちょうど1個 -->
    <img data-acf="thumbnail" src="…" alt="…">
    <h3 data-acf="title">合馬竹林公園</h3>
  </article>
  <article data-loop-sample>…</article>  <!-- ← 見た目確認用。変換時に破棄。0個以上 -->
  <article data-loop-sample>…</article>
</div>
```

| 属性 | 必須 | 値 |
|---|---|---|
| `data-loop` | ○ | CPT スラッグ |
| `data-loop-order` | | `date_desc`(既定) / `date_asc` / `menu_order` |
| `data-loop-count` | | 整数。既定 `-1`（全件） |
| `data-loop-item` | ○ | ちょうど1個 |
| `data-loop-repeat` | | 整数。既定 `1`。同じ並びを N 周ぶん出す（下記） |
| `data-loop-sample` | | 0個以上。デザイン確認用のダミー。変換器が捨てる。**中に `data-acf` は書かない**（L07） |

`data-loop-item` の中の `data-acf` は、そのCPTの**詳細ページのフィールド名と一致**させる。

**ただし一覧カードにしか出てこないフィールドは正当。** カードが詳細ページに無い要約を出すのは
普通のことで（実例: トップのイベントカードの「ソラランド平尾台 / 要予約」。詳細では会場が
タグと概要表に分かれており、この1行に当たる要素が無い）、禁止すると「カードのためだけに
詳細へ要素を足す」ことになりデザインが歪む。

- 変換器はそのフィールドを CPT のフィールド集合に合流させる（足さないと ACF 定義に載らず、
  一覧テンプレートが常に空を出力する）
- lint は **warn** で一覧に出す。名前の書き間違いも同じ形で現れるため、必ず目に入るようにする

### 3.1 `data-loop-repeat`（無限マーキー用）

CSS で `translateX(-50%)` して繋ぐ無限スクロールは、**DOM に2周ぶんのカードが無いと繋がらない**。
モックには複製が直接書かれているが、変換後は実データが1周ぶんしか出ないため、宣言が無いと
**生成物だけが途切れる**。モックを見ても気づけない壊れ方なので、宣言で明示する。

```html
<div class="facilities-track" data-loop="center" data-loop-count="10" data-loop-repeat="2">
  <a class="facility-card" data-loop-item>…</a>
  <a class="facility-card" data-loop-sample>…</a>              <!-- 見た目確認用 -->
  <a class="facility-card" aria-hidden="true" data-loop-sample>…</a>  <!-- 2周目ぶんも sample -->
</div>
```

- モック側は今まで通り2周ぶん書く（見た目を確認するため）。複製は `data-loop-sample` にする
- 変換器が同じ並びを N 周出す。**2周目以降には `aria-hidden="true" tabindex="-1"` が付く**
  （同じ項目が複数回読み上げられる・タブ移動で通過するのを防ぐ）

件数を増やしても解決しない。20件出しても2周目は別の施設になり、繋ぎ目で内容が飛ぶ。
**「同じものをもう1周」であることが条件**である。

---

## 4. 共通領域

```html
<header data-common="header">…</header>
<section data-common="cta">…</section>
<footer data-common="footer">…</footer>
```

- **同じ値の `data-common` は全ページで同一**であること（lint L09 が全ページ横断で検査）
  - ただし `href` / `src` は 7章・8章により**ページ階層に応じた相対パス**になるため、
    同じ行き先でも文字列は深さごとに異なる（`index.html` と `../index.html`）。
    L09 はパスをサイトルート基準に正規化してから比較する。**それ以外は文字列一致を要求する。**
- 現行の「半数以上のページで一致したら common」という閾値ロジックは廃止。宣言で決める
- `data-common` 内の `data-acf` はサイト共通フィールド（site-options）になる

### 4.1 共通ヘッダーを使わないページ（自前シェル）

**全ページが同じ構成を持つ必要は無い。** 申し込みフォームのように、離脱を防ぐため
ナビも CTA も落とした簡易レイアウトのページは実在する。

そういうページは **`data-common="header"` を書かない**。新しい属性は要らない。
マークアップが既に「このヘッダーはサイト共通のものではない」と言っているため。

```html
<!-- 通常ページ -->
<header class="header" data-common="header">…</header>

<!-- 申し込みページ: 宣言を書かない = 自前のシェルを持つ -->
<header class="header">…（ナビ無し）…</header>
<footer class="footer--minimal">…</footer>
```

変換器の扱い（`src/converter/lib/model.js` の `ownsShell`）:

- `data-common="header"` が**無い**ページは `get_header()` / `get_footer()` を呼ばず、
  `<head>` から `</html>` まで自前で持つ1枚のテンプレートになる
- `<head>` と `wp_head()` は `header.php` にあるため、**ヘッダーを自前で持つならフッターも自前**。
  片方だけは成立せず、`data-common="header"` が無いのに `data-common="footer"` があると停止する
- 自前シェルのページには `<body>` 直下の `<header>` と `<footer>` の両方が必要

> 実測: `events/summer-camp-apply.html` がこの形。ヘッダーにナビが無く、
> フッターは `footer--minimal`、CTA バンドも無い。既存51ページ中4枚が同じ作りだった。

---

## 5. ナビゲーション

```html
<nav data-nav="global">…</nav>
<nav data-nav="footer">…</nav>
<nav data-nav="mobile">…</nav>
```

`data-nav` の値がメニューに 1:1 で対応する。値が同じ＝同じメニュー、違う＝別メニュー。

**同じメニューを複数の位置に出してよい。** ヘッダーとフッターに同じ値を置き、見せ方だけ変える
（片方は子階層をドロップダウンに、片方は見出しとして展開する等）のは正しい書き方である。
L09 は「ページ間で同じ位置の内容が食い違っていないか」を見るので、ページ内の別位置は比較しない。

### 5.1 DOM 構造は自由

**形は縛らない。** デザイン通りに書く。`<ul><li><a>` でも `<div><a>` でも、
ドロップダウンでもアコーディオンでも、階層が何段でも構わない。class も自由。

変換器は、書かれた nav の DOM を**テンプレートとして読み、そこにメニュー項目を流し込む**。
形ごとに部品を用意するのではなく、書かれた形をそのまま再現する。これは一覧（`data-loop`）で
既にやっていることと同じ仕組みで、ナビだけ別扱いにする理由が無い。

#### 項目の宣言（`data-nav-item`）

**原則不要。** nav 直下のタグ子要素が1項目として読まれる。

宣言が必要なのは、**レイアウトの器が項目より外側に挟まる場合**だけである。

```html
<nav data-nav="footer">
  <div>                                        <!-- 列組みの器。項目ではない -->
    <div class="footer__group" data-nav-item>   <!-- ← これが1項目 -->
      <h3>活動拠点</h3>
      <div class="footer__links">…</div>
    </div>
  </div>
  …
</nav>
```

変換器は「器ごとに何件入るか」を記録して再現する。最後の器には残りを全部入れるので、
お客様が管理画面で項目を増やしても落ちない。

#### メニューではないブロックを nav の中に置く

**`data-nav-item` を付けなければ、骨組みの一部としてそのまま出力される。** 検索窓・ロゴ・
SNSリンク等、メニュー項目でないものを nav の中に残せる。

実例（本検証のフッター）: ソーシャルの3本は項目ごとに `aria-disabled` の有無が変わるため
メニューの型として再現できない。`data-nav-item` を付けないことで、マークアップのまま
出力され、URL はサイト設定として別に持てる。

> v0.1 では「nav の中身を丸ごと `wp_nav_menu()` に差し替える」作りだったため、nav の中に
> 静的なものを置けなかった。これは変換器の実装上の制約であって構造の要請ではない。
> テンプレート方式では項目の場所だけを差し替えるので、この制約は無い。

<details>
<summary>v0.1 では形を1形式に固定していた。撤回の経緯</summary>

`wp_nav_menu()` の既定 Walker が `<ul><li><a>` しか出せないため、
「形を固定すれば Walker は1つで永久に済む」として DOM 構造を1形式に縛っていた。

実測で、本検証の4つのナビのうち適合したのは1つだけだった。既存デザインの多数派を
通せない状態であり、**変換器の都合でデザインを制約していた**（設計原則1に反する）。
Walker をテンプレート再現型にすれば形は何でも通るため、この制約は削除して変換器側で引き取る。

</details>

### 5.2 未決：1つのツリーを複数の表示位置で共有する場合

同じ値の nav を複数置いたとき、**それぞれの表示内容が違ってよい**（5節の通り）。
このとき「メニューのツリー本体をどこから決めるか」が未定義である。

実例（本検証の実物トップページ）:

| 項目 | ヘッダー | フッター |
|---|---|---|
| とは？ / 活動拠点 / 地域との繋がり（＋各子） | ○ | ○ |
| イベント / お知らせ / 写真展 | ○（第1階層） | ○（「その他」の下） |
| お問合せ | ○（nav の外・ボタン） | ○（「その他」の下） |
| プライバシー / SNS 3件 | × | ○ |

同じ項目の階層が位置によって違い、片方にしか無い項目もある。
どちらか一方を「正」とすると推測になるため、**ツリーをどこに持つかを決める必要がある**。

順方向（新規案件）では、先に決めたサイト構成がそのままツリーになるためこの問題は起きない。
リバース（既存サイトの移行）でのみ発生する。**v0.2 で決める。**

---

## 5.3 パンくず

```html
<nav class="breadcrumb" data-breadcrumb aria-label="パンくず">
  <div class="container">
    <ol class="breadcrumb__list">
      <li><a href="../../">トップ</a></li>
      <li><a href="../../about/">アーバンネイチャー北九州とは？</a></li>
      <li><a href="../../about/spots.html">北九州市の自然スポット</a></li>
      <li aria-current="page">平尾台</li>          <!-- リンクなし = 現在地 -->
    </ol>
  </div>
</nav>
```

`<nav aria-label>` と `aria-current="page"` は WAI-ARIA の推奨実装。**見た目に影響しない。**
無くても WCAG 違反ではないが（後述）、あるとスクリーンリーダーに「パンくずである」ことと
現在位置が伝わる。

`data-breadcrumb` を器に1つ付けるだけ。**形は自由**（`<ol><li>` でも `<nav><span>` でもよい）。

- 祖先の項目は**モックに書かれた固定リンクのまま**出力される（リンク解決は通常の `<a>` と同じ）
- **リンクを持たない項目＝現在地**とみなし、投稿・固定ページのタイトルに差し替える

現在地の判定に宣言は要らない。パンくずの末尾がリンクにならないのは表記の必然なので、
そこから機械的に決まる。

**付け忘れると壊れる。** CPT 詳細テンプレートは1枚のモックから作られるため、
`data-breadcrumb` が無いとモックに書いた1件目の名前（例: 平尾台）が全件で出力される。

**パンくずの有無はデザインの判断であって、語彙は強制しない。** トップページや階層が
1段しかないサイトには不要。アクセシビリティ上も必須ではない（WCAG 2.4.5「複数の到達手段」は
AA だが、パンくずはそれを満たす手段の1つで、サイトマップや検索でも満たせる。
現在位置を示す 2.4.8 は AAA で本件の対象外）。

---

### 5.1 現在ページの表示（`data-nav-current`）

```html
<nav data-nav="global" data-nav-current="active">
  <a href="../events/" class="active">イベントを探す</a>
</nav>
```

`data-nav-current` の値が「現在ページを示す class」。モックは各ページで現在地の
リンクにこの class を付ける（付けないと、モックを開いて回遊したとき現在地が分からない）。

**この class だけは L09 の比較対象から外れる。** 共通領域は「全ページ同一」が条件だが、
現在ページ表示はページごとに違うのが正しいため、素直に書くと必ず違反になる。

変換器は WordPress の `current-menu-item` / `-parent` / `-ancestor` を見て、
表示時にこの class を付ける。**ナビはメニューのままなので管理画面から編集できる。**

- 一覧を持つ CPT は、**詳細ページでも一覧の項目を現在地にする**（`is_singular()` で判定）。
  WordPress は既定でそこまでやらないが、一覧項目はその投稿タイプ自体を指しているため
- 判定に URL 比較は使わない。メニュー項目を参照型（`page_id` / `post_type_archive` 等）で
  登録しているので、WordPress が現在地を教えてくれる

> 実測: この宣言を作るまで `mockup-real` から `active` が丸ごと落ちていた。
> リバース時の抜けではなく、L09 と衝突して書けなかったのが理由だった。
> 生成サイトでも現在地がどこにも出ていなかった。

---

## 6. フォーム（CF7）

```html
<form data-cf7="contact">
  <input type="text" data-cf7-field="your-name" data-cf7-required
         placeholder="例：山田 太郎" class="form-input" id="c-name">
  <textarea data-cf7-field="your-message" data-cf7-required class="form-textarea"></textarea>
  <button type="submit" data-cf7-submit>送信する</button>
</form>
```

| 属性 | 必須 | 内容 |
|---|---|---|
| `data-cf7` | ○ | フォーム識別子（CF7投稿のタイトルになる） |
| `data-cf7-field` | ○ | CF7 のフィールド名。`your-name` 等の CF7 慣行名を推奨 |
| `data-cf7-required` | | 付いていれば必須（CF7 の `*` 付きタグ） |
| `data-cf7-acceptance` | | 同意チェックであることの宣言（6.1節） |
| `data-cf7-limit` | ファイル欄は○ | ファイルサイズの上限（バイト数） |
| `data-cf7-submit` | ○ | 送信ボタン。ちょうど1個 |

### 6.1 チェックボックス・ラジオ

**選択肢のグループは、器に宣言を付ける**（`<select>` と同じ扱い）。CF7 はグループを
1タグから自前のマークアップで出力するため、器ごと1タグに畳む。

```html
<div class="checkbox-group" data-cf7-field="interest" data-cf7-required>
  <label><input type="checkbox" value="生態系保全"> 生態系保全</label>
  <label><input type="checkbox" value="環境教育"> 環境教育</label>
</div>
```
→ `[checkbox* interest class:checkbox-group "生態系保全" "環境教育"]`

選択肢の文言は `value`、無ければ対応する `<label>` のテキストから取る。

**これがモックと1:1にならない唯一の例外**（CF7 が `.wpcf7-list-item` 等の構造を出す）。
CSS は `assets/css/cf7.css` に分離し、依存箇所を1ファイルに集める。

### 同意チェックは宣言必須

**単独のチェックボックスが「同意」か「選択肢」かは、マークアップから決まらない。**

```html
<!-- 同意 -->
<input type="checkbox" data-cf7-field="privacy" data-cf7-acceptance data-cf7-required>
<!-- 単独の選択肢（同意ではない） -->
<input type="checkbox" data-cf7-field="member_optin">
```

実測: 同じフォームに `member_optin`（会員登録の希望・任意）と `privacy`（同意・必須）が
並んでいる。**必須かどうかでは区別できない。**

取り違えた場合:

| 取り違え | 結果 |
|---|---|
| 選択肢を `[acceptance]` に | チェックしないと送信できなくなる（テストで気づく） |
| 同意を `[checkbox]` に | **同意なしで送信できてしまう**（静かに通るので気づけない） |

後者を防ぐため、宣言の無い単独チェックボックスは lint が warn で必ず一覧に出す（L24）。

> v0.1 の変換器は「必須なら同意」と決め打っていた。語彙が定義していなかったので
> 変換器が推測していた箇所であり、この案件のフォームで既に間違えていた。

### ファイル欄

```html
<input type="file" data-cf7-field="photo" data-cf7-limit="10485760" accept="image/jpeg,image/png">
```
→ `[file* photo limit:10485760 filetypes:jpg|jpeg|png]`

- **`data-cf7-limit` は必須**（L24）。CF7 の既定は約1MB で、モックの表記と食い違うと
  「アップロードできない」が静かに起きる
- `filetypes` は `accept` から作る。知らない指定があれば付けない（推測しない）
- **`multiple` は出力できない。** CF7 のコア機能に無いため停止する
  （複数ファイルアップロードの拡張が必要。案件側の判断事項）

CF7 タグの生成は変換器がテンプレート化して行う。
**CF7 6.x の属性順序（クォート付き値は全ての無引用オプションより後ろ）はモック側の関心事ではない** —
`placeholder "…"` を末尾に置くのは変換器の責務。ここを人が書かないことで、
CLAUDE.md に記録されている既知の事故（タグがパースされず素テキスト出力）が構造的に起きなくなる。

### 6.2 1つのフォームを複数の投稿で使い回す（`data-cf7-group` / `data-cf7-value`）

同じ用途のフォームを投稿ごとに作ると、**投稿が増えるたびに CF7 のフォームが増える**。
CF7 のフォームは送信先・自動返信・メール本文を1件ずつ管理画面で設定するものなので、
運用コストが件数に比例して破綻する（実測: イベント4件で申込フォームが4件になっていた）。

**フォームは1つにし、投稿ごとに違う部分だけを宣言する。**

```html
<form data-cf7="event-apply">
  <!-- 投稿から値が入る hidden -->
  <input type="hidden" data-cf7-field="event-id"   data-cf7-value="post_slug">
  <input type="hidden" data-cf7-field="event-name" data-cf7-value="post_title">

  …全イベント共通の欄…

  <!-- 条件に合う投稿のときだけ出す欄 -->
  <div data-cf7-group="child" data-cf7-group-if="event_target=子ども">
    <label>お子様の氏名<input data-cf7-field="child-name" data-cf7-required></label>
  </div>
</form>
```

| 属性 | 内容 |
|---|---|
| `data-cf7-group` | グループ名（ASCII）。同名を複数箇所に書いてよい |
| `data-cf7-group-if` | `<ACFフィールド名>=<値>`。**この属性だけは値に日本語を書いてよい**（L13 の例外）。識別子ではなく比較する内容そのものだから |
| `data-cf7-value` | hidden の値の出どころ。`post_slug` / `post_title` / `post_id` |

**出し分けはサーバ側で行う。** 変換器が `wpcf7_form_elements` フィルタを生成し、
表示中の投稿の ACF 値を見て、条件に合わないグループを**HTML から削除**する。

- **JS を使わない。** 切られても隠し欄が出ない
- **必須欄が隠れて送信できなくなる問題が起きない。** 欄ごと消えるため
- **CF7 の条件分岐プラグインが要らない。** テーマの関数だけで完結する

> 判定材料は**お客様が既に入力しているフィールド**を使うこと。専用の設定項目を作ると、
> 投稿を書くたびに「このフォームでどのグループを出すか」を理解させることになり、運用が増える。
> 実例では `event_target`（個人 / 子ども / 企業）が一覧の絞り込み用に既に入力されていた。

### 6.3 フォームの中の編集対象テキスト（`data-acf`）

フォームの中にも、入力欄ではない**お客様が編集したい文章**がある（「送信後、確認メールを
お送りします」など）。ここにも普通に `data-acf` を書いてよい。

```html
<p class="apply-submit__note" data-acf="submit_note" data-acf-type="wysiwyg">
  送信後、確認メールをお送りします。<br>メールが届かない場合はお問合せください。
</p>
```

CF7 のフォーム本文は**文字列として保存される**ため PHP を埋め込めない。変換器は目印
（`<!--nkk-acf:キー:型-->`）だけを本文に置き、6.2 と同じ `wpcf7_form_elements` フィルタが
表示時に値へ差し替える。書く側は他の場所と同じ `data-acf` を書けばよい。

> これが無かったとき、フォーム内の `data-acf` はモックの文言がそのまま焼き込まれ、
> ACF には登録されるのに**編集しても何も変わらない死んだフィールド**になっていた
> （実測: `optin_title` / `optin_note` / `submit_note` の3件）。
> 画像（`image` 型）はフォーム本文では扱えないためエラーにする。

---

## 7. CSS 配置

```
css/
  base.css          ← 全ページ共通。:root 変数はここだけ
  page/
    front.css       ← data-page="front" は front.css 固定
    about_strategy.css  ← data-page="page" は data-page-id 名
    spot.css        ← CPT は data-cpt 名（single/archive 共用）
```

- **ページ内 `<style>` タグ禁止**
- **`style="…"` 属性禁止**
- `:root` の CSS 変数定義は `base.css` のみ
- **内部参照はすべて相対パスで書く。ルート絶対パス（`/` 始まり）は禁止。**
  `<link href>` はページの階層に応じた正しい相対パス（例: 深さ1のページなら `../css/base.css`）で書く。
  理由: モックは単体で開いて閲覧・回遊できる必要があり、ルート絶対パスは `file://` で開くと解決できないため。

> 実測メモ: 既存モックは 53ページ中 37ページが `<style>` を持つ。ただし `about/spots/*.html` 9枚の
> `<style>` は MD5 完全一致（分岐ではなく単なる複製）で、global と inner の二重定義も14件のみ。
> つまり既存モックは本節の構成へ**機械的に畳める**状態にある。禁止の代償は小さい。

### 7.1 JS 配置

CSS と同じ形にそろえる。

```
js/
  main.js           ← 全ページ共通（ハンバーガーメニュー等）
  page/
    front.js        ← data-page="front" は front.js 固定
    about_strategy.js   ← data-page="page" は data-page-id 名
    spot.js         ← CPT は data-cpt 名（single/archive 共用）
```

- **ページ内の `<script>` に処理を書くのは禁止**（L25）。`js/` 配下のファイルに分ける
- 読み込みは `<script src="…">`。内部参照は CSS と同じく相対パスで書く

理由は `<style>` を禁止するのと同じ。変換器はモックの HTML をテンプレートに変換するが、
**ページに直接書かれた JS はテーマのどこに置けばいいか決まらない**。ファイルになっていれば
`assets/js/` にそのままコピーして `wp_enqueue_script()` で読ませるだけで済む。

> 実測メモ: 既存モックのトップページは、ヒーローのスライドショーとモバイルナビの
> アコーディオンを `</body>` 直前の `<script>` に直接書いていた（77行）。
> `js/page/front.js` に分けて解消した。

---

## 8. 画像配置

```
images/
  common/           ← ヘッダーロゴ・CTA背景など全ページ共通
  index/            ← data-page-id / data-cpt 単位
  spot/
  meta.yaml         ← 全画像のメタ（後述）
```

- 参照は `images/` 配下のみ。外部CDN・データURI 禁止
- `alt` は全 `<img>` に必須（空 `alt=""` は `data-deco` が付いている場合のみ許可）
- **内部参照はすべて相対パスで書く。ルート絶対パス（`/` 始まり）は禁止。**
  `<img src>` もページの階層に応じた正しい相対パス（例: 深さ1のページなら `../images/...`）で書く。
  理由: モックは単体で開いて閲覧・回遊できる必要があり、ルート絶対パスは `file://` で開くと解決できないため。

### 8.1 `images/meta.yaml`

```yaml
- file: spot/auma-hero.jpg
  subject: 合馬竹林公園の竹林を見上げた構図。人物なし。
  usage: spot 詳細のヒーロー
```

画像の内容を**先に**書いておく。AI がモックを生成するとき、画像の中身を推測して配置し、
その推測のまま alt を書くと、誤配置と誤 alt が同時に発生して整合してしまい気づけない。
メタがあれば配置も alt も検証可能になる。lint は「`images/` の全ファイルが meta.yaml に載っているか」を見る。

---

## 9. lint ルール一覧

| # | ルール | 深刻度 |
|---|---|---|
| L01 | `<body>` に `data-page` がある | error |
| L02 | `data-page="page"` に `data-page-id` がある / `archive`・`single` に `data-cpt` がある | error |
| L03 | `data-acf` 値が命名規則（ASCII小文字・数字・`_`、数字始まり不可）に適合 | error |
| L04 | `data-acf` が**同一スコープ内**で重複していない。スコープはページ本体と `data-loop-item` ごとに分かれる（ループ項目のフィールドは対象 CPT の名前空間に属するため、トップに spot / center / event / news の4ループがあれば `hero_title` が4回出るのが正しい） | error |
| L05 | 型が導出できないタグに `data-acf-type` がある | error |
| L06 | `data-acf-type` の値が有効な5型のいずれか。`url` 型は `href` / `src` を持つ要素にのみ使える（2.2節） | error |
| L07 | `data-loop` 直下の `data-loop-item` がちょうど1個。`data-loop-sample` の中に `data-acf` / `data-acf-url` を書かない（捨てられるため意味を持たない） | error |
| L08 | 対応する `data-page="single"` のページが1枚も無い `data-loop` は error（一覧はあるが詳細テンプレートが無い構成ミス）。`data-loop-item` 内の `data-acf` が詳細ページに無い場合は **warn**（一覧カード専用フィールドは正当なため。3節末尾参照） | error / warn |
| L09 | 同じ `data-common` / `data-nav` の内容が全ページで一致（例外: `data-nav-current` で宣言した class は比較対象外。5.1節）。比較の単位は**値 × ページ内での出現順**で、同一ページ内の別位置どうしは比較しない（同じメニューを複数の位置に違う見せ方で出すのは正しい書き方のため。5節） | error |
| L10 | `data-cf7-submit` がフォーム内にちょうど1個 | error |
| L24 | 単独チェックボックスに `data-cf7-acceptance` の有無が明示されている（warn）／ファイル欄に `data-cf7-limit` がある（error）。6.1節 | error / warn |
| L11 | ページ内 `<style>` タグが無い | error |
| L12 | `style="…"` 属性が無い | error |
| L13 | class 名・`data-*` 値が全て ASCII（例外: `data-cf7-group-if` は比較する内容そのもの、`data-section-label` は画面に出る文言なので日本語可。6.2節 / 2.5節） | error |
| L14 | 画像参照が `images/` 配下のみ（検査対象は `<img src>`。CSS の `background-image` と favicon は v0.1 では対象外） | error |
| L15 | 全 `<img>` に `alt`（空 alt は `data-deco` **または `aria-hidden="true"`** が自身か祖先に付いている場合のみ。カルーセルの無限ループ用に複製されたカード等が該当） | error |
| L16 | `images/` の全ファイルが `meta.yaml` に載っている | error |
| L18 | 見出しレベルの飛びが無い（h1→h3 等） | error |
| L19 | `<section>` に class か `data-*` の**少なくとも一方**がある（両方あってよい。デザイン用 class と構造宣言は併存する） | error |
| L20 | **`data-acf` の無いテキストノードの一覧**（＝更新対象外になる文言） | **warn** |
| L23 | `data-acf-type="wysiwyg"` の中に `data-acf` / `data-acf-url` を書かない（2.6節） | error |
| L21 | 内部参照（`<link href>` / `<img src>` / `<a href>`）がルート絶対パスでない（外部URL・`mailto:`・`tel:`・`#`アンカーは対象外） | error |
| L25 | ページ内に処理を書いた `<script>` が無い（`js/` 配下のファイルに分ける。ページ固有なら `js/page/<ページID>.js`。7.1節） | error |
| L26 | `<section>` に `data-section` がある（`data-common` 配下と `data-loop-item` / `data-loop-sample` 配下は除く）。2.5節 | error |
| L27 | 同じ中身の子を複数持つ `data-loop` に `data-loop-repeat` がある。宣言がある場合は「子の総数＝異なる中身の数 × 周回数」が成り立つ。3.1節 | error |
| L30 | モック内リンクの行き先がモックに実在する（`data-nav` の中も対象）。裏返しに、**どこからもリンクされていないページ**は warn で報告する。同じ行き先の重複は1件にまとめる | error / warn |
| L31 | 同じフィールドの型が宣言箇所で食い違わない。型が `wysiwyg` なら `<p>` に宣言しない（wysiwyg の値は `<p>` に包まれて出るため入れ子が壊れ、class を持つ要素が空になる）。2.7節 | error |
| L29 | `data-cf7-group` に `data-cf7-group-if` がある／`data-cf7-group` と `data-cf7-value` は `data-cf7` の内側にだけ書く／`data-cf7-value` の値が `post_slug` / `post_title` / `post_id` のいずれか。6.2節 | error |

### 9.0 欠番（削除したルール）

**番号は再利用しない。** 過去のログや検査結果と突き合わせられなくなるため。

| # | 元のルール | 削除した理由 |
|---|---|---|
| L17 | `base.css` と `css/page/*.css` で同じセレクタを二重定義しない | CSS の上書きを禁止するルールだった。しかし共通CSSをページ側で上書きするのは**普通にやること**なので、ルールとして不適当だった。上書きがあっても変換は問題なく通るし、見た目も変わらない（実測でピクセル差分0）。`mockup-real` で21件出ていたが、どれも違反ではなく「上書きしてますよ」という報告にすぎなかった |
| L22 | nav のマークアップを決まった形に固定する | 変換器が扱える形が限られていたので、それに合わせてデザインを縛るルールだった。「デザインは自由」という原則に反する。変換器の側を直して**どんな形でも通る**ようにしたので、要らなくなった |

**L20 が運用上いちばん重要。** 唯一の残存リスクは「宣言の付け忘れ」で、これは静かに失敗する
（ACF化されず固定文言になり、誰も気づかない）。lint がこの一覧をレポートとして出し、
**「これらは更新対象外」としてお客様と合意する**ところまでやって、初めて取りこぼしが
事故ではなく合意事項になる。

### 9.1 lint 以外の受入条件

- **pa11y（axe-core ランナー・WCAG2AA）通過**。モック段階で通す。WP化後に直すと
  モックとの差分が生まれ、「モックで合意したもの＝納品物」という前提（柱①）が崩れる。
  本案件で検出された axe-core 違反204件は、その大半がモック由来と見られる。
- **実行方法**: `node src/a11y/check.js [mockupDir]`。
  モック配下の全 `*.html` に pa11y を `--standard WCAG2AA --runner axe`
  相当の設定でかけ、**error が1件でもあれば非ゼロ終了**する。人が読める出力
  （ページ別の違反件数・ルールID・セレクタ・該当要素）と `--json` の両方に対応する。
  CI・pre-commit 等はこのコマンドの終了コードをゲートにすること。
- **既知の除外は `frame-tested` の1ルールのみ**。地図の `<iframe>` は `file://` で
  開くと cross-origin になり、axe-core がフレーム内部を検査できないために出る
  偽陽性で、実サイト（同一オリジン配信）では発生しない。除外理由は
  `src/a11y/check.js` 内のコメントに明記し、除外した件数は実行結果に
  必ず表示する（黙って消さない）。これ以外のルールを「直すのが面倒だから」
  という理由で除外リストに追加してはならない。
- **プロンプトに書くだけでは守られない。ゲート（`src/a11y/check.js` の
  非ゼロ終了）が唯一の担保である。** モック生成プロンプトに「WCAG 2.0 AA を
  通す前提」と明記していても、それを実行する仕組みが無ければ守られない
  ことが実測（axe-core 違反31件、うち color-contrast 30件・frame-tested 1種）
  で判明している。

### 9.2 既存51ページの扱い

既存モックを lint に通して**合格させるためにルールを緩めてはならない**。
lint を先に確定し、既存が落ちるなら落ちたままでよい。既存モックの用途は
「この語彙で実案件のページを表現しきれるか」というカバレッジ検査であって、手本ではない。

---

## 10. 変換器が保証すること（本語彙の対価）

モック側がこの語彙を守る代わりに、変換器は以下を**決定的に**生成する。AI は介在しない。

| 生成物 | 入力 |
|---|---|
| `inc/acf-<slug>.php` | `data-acf` / `data-acf-type` |
| `functions.php` の CPT 登録・`register_nav_menus()` | `data-cpt` / `data-nav` |
| `front-page.php` / `page-*.php` / `archive-*.php` / `single-*.php` | `data-page` ＋ モック HTML |
| フィールド出力（`the_field()` 置換） | `data-acf` の位置 |
| CF7 フォーム定義 | `data-cf7-*` |
| `assets/css` / `assets/images` | `css/` / `images/` |

置換元・宣言が見つからない場合は**エラーで停止**する。黙って握りつぶさない。
これにより、現行手法で発生していた「ACF に登録したがテンプレートに出力し忘れる」
（実測: 活動ブログ 2/14 一致、活動拠点 22/34 一致）が構造的に発生しなくなる。

---

## 一時的に緩めている箇所

**設計原則3（エスケープハッチを作らない）に穴を開けているもの。外す条件を明記する。**

| 対象 | 有効化 | 内容 | 外す条件 |
|---|---|---|---|
| 未解決の内部リンク | `node convert.js … --allow-unresolved-links` | まだ存在しないページへのリンクを、エラーではなく警告にして href をそのまま残す | **モックの全ページが揃った時点** |

既定では無効。渡した場合は生成が成功しても必ず警告の要約を出す
（緩めたことが見逃されないようにするため）。

**外し忘れると、行き先の無いリンクを含むテーマがそのまま本番に出る。**
モックのページを揃える途中で WordPress 上の動作確認まで先に進めるための措置であり、
恒久的な仕様ではない。

---

## 未決事項

- `wysiwyg` の粒度（どこまでを1フィールドにまとめるか）は人の判断が残る
- 一覧のページング宣言（`data-loop-paged`）は v0.1 では未定義
- 条件表示（値が空なら非表示にする等）の宣言方法は未定義
- 多言語は対象外（ichiki.md: 日本語単一）
- 宣言方法が未定義の要素。**使う場合は「更新対象外の固定コンテンツ」として扱い、
  `data-acf` を付けない**
  - `<video>` / `<iframe>`（YouTube 等の埋込）※ `iframe` の `src` だけは
    `data-acf-type="url"` で扱える（2.2節）
  - `<details>` / `<summary>`
  - パンくずの中身（器の `data-breadcrumb` は決まっているが、項目ごとの宣言は無い）
- ~~内部参照が絶対パス（`/about/x.html`）と相対パス（`../about/x.html`）のどちらの記法か未定義~~
  → **解決済み。** 内部参照（CSS・画像・ページリンク）は相対パス必須、ルート絶対パス禁止と確定した
  （本節末尾の §7・§8 参照。lint L21 で機械検査する）。この曖昧点は変換器側
  （`src/converter/lib/link-resolve.js` のコメント）から報告されたもので、
  v0.1 の実例（役割を終えて削除済み）がルート絶対パスを使っていたために発覚した。

### リバース（既存サイトの移行）でのみ起きること

順方向（新規案件）では発生しないが、既存モックを制約語彙に書き直す場合に出る。

1. **メニューのツリーをどこから決めるか**が未定義（5.2節）。順方向ならサイトマップがそのまま
   ツリーになるが、リバースは複数の表示位置から逆算する必要がある。
2. **CPT 詳細ページが複数あるとき、マークアップの差を検査していない。** フィールド名の一致は
   見ているが構造は見ていないため、代表ページ（1枚目）に無い要素は全件から静かに消える。
   実測: `hiraodai.html` にだけパンくずを付けて変換したところ、代表の `auma.html` に無いため
   何も警告されずに出力から消えた。順方向なら詳細は1枚のテンプレートから作るので起きない。
   **当面は代表ページを1枚に絞って運用し、検査の実装は後回しとする。**
3. パンくずの有無・ナビの見せ方など、**デザインの判断がモックにしか残っていない**。
   順方向なら設計時に決まる。

### v0.1 の PoC（7ページの制約モック。役割を終えて削除済み）で判明した穴

1. ~~**文中リンクの分断**~~ → **解決済み（2.6節）。** 文ごと `wysiwyg` にする。内側に
   `data-acf` / `data-acf-url` は書けない（L23）。wysiwyg の中の固定リンクは変換器が
   パーマリンクへ解決する（相対パスのまま ACF のデフォルト値に残る不具合を実測で確認し、修正済み）。
2. ~~**パンくずリスト**が未定義。~~ → **解決済み。** `data-breadcrumb` を器に付け、リンクを持たない末尾項目を現在地として投稿タイトルに差し替える（5.3節）。未定義のままだと CPT 詳細で1件目の名前が全件に出力される不具合になるため、実装まで済ませた。
3. ~~**単一インスタンス CPT の archive テンプレートの要否**~~ → **解決済み。** 宣言で決まる。
   `data-page="archive"` のページがあれば `archive-<cpt>.php` を生成し、無ければ生成しない。
   推測の余地が無いので未決にしておく理由が無かった（実装は既にこの通りになっていた。
   実測: `network` は詳細のみ宣言されており `single-nkk_network.php` だけが生成される）。
4. ~~**`data-loop-sample` 内に `data-acf` を書いてよいか**が未定義。~~ → **解決済み。書かない（L07）。**
   サンプルは変換時に丸ごと捨てられるので宣言に意味が無い。
   **実測でバグが出た**: 除外し忘れていたため、サンプル内の `data-acf` が実際に ACF フィールドとして
   登録されていた（テンプレートのどこにも出てこない入力欄が管理画面に並ぶ）。除外処理を
   1箇所にまとめて修正し、lint でも書いた時点で止めるようにした。
5. ~~**`<a>` 以外の URL 属性**（`<iframe src>` の地図等）への宣言方法が未定義。~~
   → **解決済み（2.2節）。** `data-acf-type="url"` が `href` / `src` の両方に使える。
   実装は既にこの通りだったが、記述が追いついていなかった。あわせて出力の
   `esc_url()` 漏れを修正（image は通していたのに url 型だけ生のまま出していた）。
6. ~~**CF7 の `<select>` / チェックボックス**の宣言が未定義。~~ → **解決済み（6.1節）。**
   グループは器に宣言、同意は `data-cf7-acceptance` で明示、ファイル欄は `data-cf7-limit` 必須。
   `radio` / `file` / `hidden` も対応した。`multiple` はコア機能に無いため停止する。
7. **未使用画像の検査が無い**。L16 は「`images/` の全ファイルが meta.yaml に載っているか」の一方向のみで、
   どのページからも参照されない画像は検出できない（L21 候補）。
