# モックアップ生成プロンプト（Ichiki 制約準拠）

AI にモックアップを作らせるときに、案件情報とあわせて渡すプロンプト。

**このファイルは `proposal/vocabulary.md` の派生物である。** 各ルールに lint のルールID（L01〜L21）を
併記してあるので、語彙・lint・本プロンプトの3者がズレたら ID で突き合わせて検出できる。
**ルールを追加・変更するときは必ず3つとも直すこと。** 過去に lint だけ直して変換器が取り残され、
数時間で乖離した実績がある。

---

## 使い方

1. 下の「案件情報」を埋める
2. 「### ここから下をAIに渡す」以降をそのまま渡す
3. 生成物に対して次を全部通す。**1つでも落ちたら未完成**

```bash
node proposal/lint/lint.js <mockupDir>      # 構造（L01〜L21）
node proposal/a11y/check.js <mockupDir>     # アクセシビリティ（WCAG2AA）
node proposal/scan/scan.js <mockupDir> <out> # acf-map.yaml 生成・取りこぼし検証
```

4. lint の L20（宣言の無いテキスト一覧）を出力し、**「これらは更新対象外」としてお客様と合意する**

---

## 案件情報（埋める）

```
プロジェクト名 :
サイトの目的   :
配色・トーン   : （例: 落ち着いた緑基調。自然・公共施設らしく）
参考にするサイト: （URL。「モダンに」等の抽象語より具体例のほうが効く）
リプレイス前   : （既存サイトのURL、または「新規」）
画像の場所     : （ディレクトリパス。images/meta.yaml も必ず用意すること）
ページ構成     :
  - / （トップ）
  - /about/strategy （固定ページ）
  - /spots/ （一覧）+ /spots/<slug> （詳細 = CPT: spot）
  - ...
CPT一覧        : spot / center / event / news など
フォーム       : お問合せ / 参加申込 など
```

---

### ここから下をAIに渡す

あなたは WordPress 化を前提としたモックアップを作ります。
**デザインは自由ですが、構造は以下の規約に厳密に従ってください。**

デザイン（色・レイアウト・雰囲気）は人がモックで合意するため主観で構いません。
構造（何が編集対象か・何がCPTか・どこが共通か）は機械が変換するため、宣言が必須です。
**推測させないでください。** 宣言が無いものは変換器がエラーで停止します。

---

## 1. ページ宣言【L01 / L02】

すべての HTML の `<body>` に必ず付けます。

```html
<body data-page="front">                                   <!-- トップ -->
<body data-page="page" data-page-id="about_strategy">       <!-- 固定ページ -->
<body data-page="archive" data-cpt="spot">                  <!-- CPT一覧 -->
<body data-page="single" data-cpt="spot">                   <!-- CPT詳細 -->
```

`data-page-id` はファイルパス由来（`about/strategy.html` → `about_strategy`、`index.html` は畳む）。

> **重要**: CPT の詳細ページが**1枚しかなくても** `data-cpt` を書いてください。
> 宣言が無いと「複数ページの構成が一致するか」で推測するしかなく、1件の CPT は原理的に検出できません。

## 2. セクション宣言【L19 / L26】

`<section>` には必ず `data-section` を付けます【L26】。値は意味のある名前（`front_hero` / `spot_detail` 等）。

付け忘れても**変換は成功してしまいます**（acf-map.yaml のセクション分けが失われるだけ）。
モックを見ても生成物を見ても気づけないので、lint が error で止めます。
`data-common` 配下と、`data-loop-item` / `data-loop-sample` 配下の `<section>` には不要です。

```html
<section data-section="spot_detail" class="section section--white">…</section>
```

`data-common` を持つ section には不要です。

> レイアウト用クラス（`section--white` 等）からは意味が導出できません。
> フィールド名の接頭辞からも導出できません（1つのセクションに複数の接頭辞が混在するため）。

## 3. フィールド宣言【L03 / L04 / L05 / L06】

**編集される可能性のある要素すべて**に `data-acf` を付けます。付いていないものは固定文言になります。

```html
<h1 data-acf="hero_title">都市と自然、<br>近いからこそおもしろい。</h1>
<p  data-acf="hero_lead">北九州の自然を、もっと身近に。</p>
<img data-acf="hero_image" src="../images/spot/auma.jpg" alt="合馬竹林公園の竹林">
<a href="../contact/index.html" data-acf="cta_label" data-acf-url="cta_url">お問合せ</a>
```

### 型は原則自動。導出できないタグだけ明示する

| タグ | 型 |
|---|---|
| `h1`〜`h6` | text |
| `p` `li` `dd` `td` `span` | textarea |
| `img` | image |
| `a` | text（href は `data-acf-url`） |
| **`div` `section` など上記以外** | **導出不可 → `data-acf-type` が必須** |

有効な型: `text` / `textarea` / `wysiwyg` / `url` / `image`

`url` 型は `<a href>` だけでなく **`src` にも使えます**【L06】。地図の埋め込みなどはこれで宣言してください。

```html
<iframe data-acf="map_src" data-acf-type="url" src="https://maps.google.com/…"></iframe>
```

対象にできるのは `href` / `src` の2属性だけです。

```html
<div data-acf="body" data-acf-type="wysiwyg"><p>…</p><p>…</p></div>
<p data-acf="fee" data-acf-type="text">無料</p>
```

### 命名規則

- `{セクション}_{種別}`、同種が複数なら `_{連番}`（`hero_title` / `features_icon_1`）
- **ASCII 小文字・数字・アンダースコアのみ。数字始まり禁止**（PHP変数・ACFキーになるため）
- **class 名と `data-*` の値も全て ASCII**【L13】。日本語のクラス名は禁止
  （実在例: `event-card__type-tag--募集中`。CSS では動くが PHP 変数・ACF キーへの変換で確実に事故る）
- 同一スコープ内で重複禁止。スコープはページ本体と `data-loop-item` ごと
  （トップに spot / center / event の3ループがあれば `hero_title` が3回出るのは正しい）

### テキストの書き方【D】

- `<br>` `<strong>` `<em>` 等の**整形タグはフィールド内に書いてよい**（見出しの改行制御など）
- **文中にリンクを含む文は、リンクだけを宣言しないでください。** 地の文が分断されます

```html
<!-- NG: 地の文が宣言から漏れる -->
<p>詳しくは<a data-acf="link_label" data-acf-url="link_url">こちら</a>をご覧ください。</p>

<!-- OK: 文ごと1フィールドにする（wysiwyg なので <div>。7.10節【L31】） -->
<div data-acf="note" data-acf-type="wysiwyg">詳しくは<a href="../contact/">こちら</a>をご覧ください。</div>
```

- **wysiwyg の中に `data-acf` / `data-acf-url` は書けません**【L23】。まとまり全体を1つのフィールドとして編集するためです
- wysiwyg の中の固定リンクは、変換器がパーマリンクへ解決します。相対パスのままで構いません

### 装飾要素

装飾は `data-deco` か `aria-hidden="true"` を付け、`data-acf` は付けません。

## 4. 一覧ループ【L07 / L08】

CPT の一覧を出す箇所に付けます。

```html
<div data-loop="spot" data-loop-order="menu_order" data-loop-count="3">
  <article data-loop-item>                    <!-- テンプレート。ちょうど1個 -->
    <img data-acf="hero_image" src="…" alt="…">
    <h3 data-acf="hero_title">合馬竹林公園</h3>
  </article>
  <article data-loop-sample>…</article>       <!-- 見た目確認用。変換時に破棄。0個以上 -->
</div>
```

- `data-loop-item` の `data-acf` 名は、**その CPT の詳細ページのフィールド名と一致**させること
  - ただし**カードにしか出てこないフィールド**（カード用の要約行など）は書いてよい。lint が warn で一覧に出すので、書き間違いでないか確認してください
- `data-loop` を書いた CPT は、**詳細ページ（`data-page="single"`）を必ず1枚は用意**すること
- **`data-loop-sample` の中に `data-acf` を書かないでください**【L07】。変換時に丸ごと捨てられるので意味がありません

**無限スクロールのカルーセルを作る場合は `data-loop-repeat` を付けてください**【L27】。

```html
<div class="track" data-loop="center" data-loop-count="10" data-loop-repeat="2">
```

CSS で `translateX(-50%)` して繋ぐ形は、DOM に2周ぶんのカードが必要です。モックには複製を書いて構いませんが（`data-loop-sample` にする）、**宣言が無いと変換後は1周ぶんしか出ず、生成されたサイトだけカルーセルが途切れます。** モックを見ても気づけないので、必ず書いてください。

## 5. 共通領域【L09】

```html
<header data-common="header">…</header>
<section data-common="cta">…</section>
<footer data-common="footer">…</footer>
```

**全ページで完全に同一**にしてください（相対パスの深さの違いだけは許容されます）。
一度書いたものをコピーして貼ってください。

## 6. ナビゲーション【L09】

`data-nav` でメニュー位置を宣言します。**DOM の形は自由です。** デザイン通りに書いてください。

```html
<nav data-nav="global" aria-label="メインナビゲーション">…</nav>
<nav data-nav="footer">…</nav>
```

| | |
|---|---|
| 形 | **自由。** `<ul><li><a>` でも `<div><a>` でも、ドロップダウンでもアコーディオンでも可 |
| 階層 | **自由。** 何段でも可 |
| class | 自由。見た目は CSS で作る |
| 項目の宣言 | **原則不要**（nav 直下の子が1項目）。レイアウトの器が挟まる場合だけ `data-nav-item` |

モバイルの開閉ボタンのように、**項目そのものに付随する** UI は項目の中に置いて構いません（項目ごとに複製されます）。

**レイアウトの器が挟まる場合だけ、項目に `data-nav-item` を付けます。**

```html
<nav data-nav="footer">
  <div>                                        <!-- 列組みの器。項目ではない -->
    <div class="footer__group" data-nav-item>   <!-- ← これが1項目 -->
      <h3>活動拠点</h3>
      <div class="footer__links">…</div>
    </div>
  </div>
</nav>
```

**メニュー項目でないブロックは、`data-nav-item` を付けずに nav の中に置けます。** そのまま出力されます。SNSリンクのように項目ごとに属性が変わるものは、こちらにしてください。

**同じメニューを複数の位置に出す場合は、同じ値を付けます。**

```html
<header>…<nav data-nav="global">…</nav>…</header>
<footer>…<nav data-nav="global">…</nav>…</footer>   <!-- 見せ方が違ってよい -->
```

値が同じ＝同じメニュー、違う＝別メニューです。ヘッダーは子階層をドロップダウンに、
フッターは見出しとして展開する、といった違いは正しい書き方です。

> 変換器は、書かれた nav の DOM を**テンプレートとして読み、そこに項目を流し込みます**。
> 形ごとに部品を用意するのではなく、書かれた形をそのまま再現します。
> 一覧（`data-loop`）で見本を1件書くのと同じ仕組みです。

## 6.1 パンくず

```html
<nav class="breadcrumb" data-breadcrumb aria-label="パンくず">
  <ol class="breadcrumb__list">
    <li><a href="../../">トップ</a></li>
    <li><a href="../../about/spots.html">北九州市の自然スポット</a></li>
    <li aria-current="page">平尾台</li>   <!-- リンクなし = 現在地 -->
  </ol>
</nav>
```

器に `data-breadcrumb` を1つ付けるだけです。**形は自由**です。

- 祖先の項目は書いたリンクのまま出力されます
- **リンクを持たない項目が現在地**とみなされ、投稿タイトルに差し替わります
- `<nav aria-label>` と `aria-current="page"` を付けてください（見た目に影響しません）
- **パンくず自体が不要なページには付けなくて構いません**（トップページ等）

**付け忘れると壊れます。** CPT 詳細ページは1枚のモックからテンプレートを作るため、宣言が無いとモックに書いた名前（例: 平尾台）が全件に出力されます。

## 7. フォーム【L10】

```html
<form data-cf7="contact">
  <label for="c-name">お名前</label>
  <input type="text" id="c-name" data-cf7-field="your-name" data-cf7-required
         class="form-input" placeholder="例：山田 太郎">
  <textarea id="c-msg" data-cf7-field="your-message" data-cf7-required class="form-textarea"></textarea>
  <button type="submit" data-cf7-submit>送信する</button>
</form>
```

- フィールド名は CF7 の慣行名（`your-name` / `your-email` / `your-message`）を推奨
- `data-cf7-submit` はちょうど1個
- **すべての入力に `<label for>` を紐付ける**（アクセシビリティ）

### チェックボックス・ラジオ【L24】

**選択肢のグループは器に宣言します**（`<select>` と同じ）。

```html
<div class="checkbox-group" data-cf7-field="interest" data-cf7-required>
  <label><input type="checkbox" value="生態系保全"> 生態系保全</label>
  <label><input type="checkbox" value="環境教育"> 環境教育</label>
</div>
```

**同意チェックには `data-cf7-acceptance` を付けてください。**

```html
<input type="checkbox" data-cf7-field="privacy" data-cf7-acceptance data-cf7-required>
```

単独のチェックボックスが「同意」か「選択肢」かはマークアップから決まりません。付け忘れると**同意なしで送信できる**状態になり、送信は成功するので誰も気づきません。付いていない単独チェックボックスは lint が warn で出します。

### ファイル欄【L24】

```html
<input type="file" data-cf7-field="photo" data-cf7-limit="10485760" accept="image/jpeg,image/png">
```

- **`data-cf7-limit`（バイト数）は必須**です。CF7 の既定は約1MB で、書かないと表記と食い違ったまま通ります
- `multiple` は Contact Form 7 のコア機能では出力できません（拡張プラグインが必要）

### 1つのフォームを複数の投稿で使い回す【L29】

イベント申込のように「投稿ごとに申込フォームがある」場合、**投稿ごとにフォームを作らないでください**。
CF7 のフォームは送信先・自動返信・メール本文を1件ずつ管理画面で設定するので、
投稿が増えるたびに設定作業が増えて破綻します（実測: イベント4件でフォームが4件になっていました）。

```html
<form data-cf7="event-apply">
  <input type="hidden" data-cf7-field="event-id"   data-cf7-value="post_slug">
  <input type="hidden" data-cf7-field="event-name" data-cf7-value="post_title">

  …全投稿で共通の欄…

  <div data-cf7-group="child" data-cf7-group-if="event_target=子ども">
    <label>お子様の氏名<input data-cf7-field="child-name" data-cf7-required></label>
  </div>
</form>
```

| 属性 | 内容 |
|---|---|
| `data-cf7-group` | グループ名（ASCII） |
| `data-cf7-group-if` | `<ACFフィールド名>=<値>`。**ここだけ日本語を書いてよい**（比較する内容そのものなので） |
| `data-cf7-value` | hidden に入れる値。`post_slug` / `post_title` / `post_id` |

出し分けは変換器が作るサーバ側フィルタが行います。条件に合わないグループは**HTML から消える**ので、
JS を切られても隠し欄が出ず、必須欄が隠れて送信できなくなることもありません。

> **判定材料は、お客様が既に入力しているフィールドを使ってください。**
> 「このフォームでどのグループを出すか」という専用の設定項目を作ると、
> 投稿を書くたびにその意味を理解させることになり、運用が増えます。
> 実例では `event_target`（個人 / 子ども / 企業）が一覧の絞り込み用に既に入力されていました。

## 7.9 リンクの行き先【L30】

**モック内のリンクは、モックに実在するページを指してください。**
書いていないページへのリンクは error になります。

- `data-nav`（ナビ）の中も対象です。ナビは変換時に `wp_nav_menu()` へ置き換わるため、
  **変換器は中の href を見ません**。ここで止めないと誰も気づきません。
  実測: ナビが参照する10施設のうち9件がモックに無く、投入時に項目が黙って落ちて
  **25本のはずのナビが15本**になっていました。
- 裏返しに、**どこからもリンクされていないページ**は warn で報告します。
  リンク切れの逆側で、同じ整合性の欠落です。

## 7.10 wysiwyg のフィールドは `<div>` に書く【L31】

**`data-acf-type="wysiwyg"` を `<p>` に書かないでください。** `<div>` を使います。

ACF の wysiwyg は値を `<p>` で包んで出すため、`<p>` の中に置くと
`<p class="x"><p>本文</p></p>` という不正な入れ子になります。ブラウザは内側の `<p>` を
見た時点で外側を閉じるので、**class を持つ要素が空になり CSS が本文に効きません。**
文字は画面に出るので、目で見ても気づけません。

あわせて2点:

- **同じフィールド名を別の型で宣言しないでください。** ACF のフィールドは1つなので
  型も1つに決まり、食い違うと片方の宣言箇所が壊れます。
  実測: `event_meta` が一覧では `<p>`（textarea）、申込ページでは `<div>` の wysiwyg でした。
- **wysiwyg のフィールドを `p` 要素セレクタで整形しないでください。** `<div>` になるので
  当たりません。class セレクタで書いてください。

> 中身が `<br>` `<strong>` `<em>` などの**文字装飾だけ**なら wysiwyg は要りません。
> textarea のままで通ります。wysiwyg が要るのは、文中にリンクを含む場合（2.6節）など、
> 内側にタグ構造を持つときです。

## 7.11 ナビの現在ページ表示【L09 の例外】

現在いるページのリンクには、**現在地が分かる class を付けてください。**
そして `<nav>` に、どの class がそれかを宣言してください。

```html
<nav data-nav="global" data-nav-current="active">
  <a href="../events/" class="active">イベントを探す</a>
</nav>
```

- 宣言した class **だけ**は、L09（共通領域は全ページ同一）の比較から外れます
- 一覧を持つ CPT の**詳細ページでは、その一覧のリンク**に付けてください
  （イベント詳細なら「イベントを探す」）
- 付けないと、モックを開いて回遊したときに現在地が分かりません

変換器が WordPress の現在ページ判定を見て、表示時に同じ class を付けます。
ナビはメニューのままなので、お客様は管理画面から編集できます。

## 8. CSS【L11 / L12】

```
css/
  base.css              全ページ共通。:root 変数はここだけ
  page/
    front.css           data-page="front" は front.css 固定
    about_strategy.css  data-page="page" は data-page-id 名
    spot.css            CPT は data-cpt 名（一覧・詳細で共用）
```

| ルール | |
|---|---|
| **ページ内 `<style>` タグ** | **禁止**【L11】 |
| **`style="…"` 属性** | **禁止**【L12】 |
| `:root` の変数定義 | `base.css` のみ |
| CSS 内の `url()` | **その CSS ファイルからの相対パスで書く**（`css/page/` から画像なら `../../images/…`） |

> `base.css` の変数を `page/*.css` で別名再定義しないでください。
> 実例として、既存モックのトップページは `--primary` と `--color-primary` という
> **2つの独立したデザインシステム**を持っており、統合に設計判断が必要な状態になっていました。

## 8.1 JavaScript【L25】

CSS と同じ形にそろえます。

```
js/
  main.js               全ページ共通（ハンバーガーメニュー等）
  page/
    front.js            data-page="front" は front.js 固定
    about_strategy.js   data-page="page" は data-page-id 名
    spot.js             CPT は data-cpt 名（一覧・詳細で共用）
```

| ルール | |
|---|---|
| **ページ内の `<script>` に処理を書く** | **禁止**【L25】 |
| 読み込み | `<script src="…">`。パスは CSS と同じく相対で書く |

理由は `<style>` の禁止と同じです。ページに直接書かれた JS は、**WordPress テーマの
どこに置けばいいかが決まりません**。ファイルになっていれば `assets/js/` にコピーして
読み込ませるだけで済みます。

> 実例: 既存モックのトップページは、ヒーローのスライドショーとモバイルナビの
> アコーディオンを `</body>` 直前の `<script>` に直接書いていました。

## 9. 画像【L14 / L15 / L16】

```
images/
  common/          全ページ共通（ロゴ・CTA背景など）
  <page-id>/       ページ / CPT 単位
  meta.yaml        全画像の台帳
```

`images/meta.yaml`:

```yaml
- file: spot/auma-hero.jpg
  subject: 合馬竹林公園の竹林を見上げた構図。人物なし。
  usage: spot 詳細のヒーロー
```

| ルール | |
|---|---|
| 参照先 | `images/` 配下のみ。外部CDN・データURI 禁止【L14】 |
| `alt` | 全 `<img>` に必須。空 `alt=""` は `data-deco` か `aria-hidden="true"` がある場合のみ【L15】 |
| meta.yaml | `images/` の全ファイルを記載【L16】。**CSS の背景画像も含める** |

> 画像の内容を推測して配置し、その推測のまま alt を書くと、誤配置と誤 alt が同時に発生して
> 整合してしまい気づけません。**meta.yaml を先に読んでから配置してください。**

## 10. パス【L21】

**内部参照はすべて相対パス。ルート絶対パス（`/` 始まり）は禁止。**

| ページの位置 | CSS | 画像 | 他ページ |
|---|---|---|---|
| `index.html`（深さ0） | `css/base.css` | `images/…` | `about/strategy.html` |
| `spots/auma.html`（深さ1） | `../css/base.css` | `../images/…` | `../about/strategy.html` |

- ディレクトリ形式のリンク（`spots/`）ではなく**ファイル名まで書く**（`spots/index.html`）
- 外部URL・`mailto:`・`tel:`・`#` アンカーはそのまま

> モックアップは**単体でブラウザで開いて閲覧・回遊できる必要があります**。
> ルート絶対パスは `file://` で開くと解決できません。

## 11. アクセシビリティ【L15 / L18】

モック段階で **WCAG 2.0 AA** を通してください。後から直すと、合意済みのデザインとの差分が生まれます。

- 見出しレベルを飛ばさない（h1 → h3 は禁止）【L18】
- 本文のコントラスト比 4.5:1 以上、大きい文字は 3:1 以上
- ランドマーク（`header` / `nav` / `main` / `footer`）とスキップリンク
- フォームの `<label for>` 紐付け
- キーボードのみで操作でき、フォーカスが見えること

> `node proposal/a11y/check.js` の「要人手確認」は、axe が**測定できなかった**項目です。
> 「問題なし」ではありません。写真の上の文字などは実際の描画で目視確認してください。

## 12. デザインの方針

「AIっぽさ」を避けてください。具体的に避けるもの:

- 見出しに絵文字を使う
- グラデーションの多用
- 等間隔3列カードの単調な反復
- 意味のない装飾アイコンの羅列
- 「〜しませんか？」調の勧誘コピー
- フォント指定が `system-ui` / `Inter` だけ

抽象的な「モダンに」より、**参考サイトを具体的に指定されたらそれに寄せてください。**

## 13. 語彙が扱いを決めていない要素

以下は現時点で宣言方法が未定義です。**使う場合は「更新対象外の固定コンテンツ」として扱い、
`data-acf` を付けないでください。**

- `<video>` / `<iframe>`（YouTube等の埋込）
- `<details>` / `<summary>`
- カルーセルの無限ループ用に複製したカード（`aria-hidden="true"` を付ける）
- パンくずリスト

---

## 完成の定義

```bash
node proposal/lint/lint.js <mockupDir>       # → exit 0（error 0件）
node proposal/a11y/check.js <mockupDir>      # → exit 0（error 0件）
node proposal/scan/scan.js <mockupDir> <out> # → 未分類（取りこぼし）0
```

3つすべてが通り、かつ **L20 の「宣言の無いテキスト一覧」をお客様に提示して
「これらは更新対象外」の合意が取れて**、初めて完成です。

**lint を通すためにルールを緩めてはいけません。** ルールが実態に合わないと判断した場合は、
勝手に回避せず報告してください。
