# Ichiki 固定ルール（mockup→WordPress）

<!-- 全案件共通。案件用CLAUDE.mdから @import される。ここは案件ごとに書き換えない -->

## このファイルと vocabulary.md の分担

`rules/` には2つのルールがあり、書くことを分けている。**同じことを2箇所に書かない。**

| | 中身 |
|---|---|
| **ichiki.md**（このファイル） | 前提・環境・成果物の規定・運用の約束。**案件をどう進めるか** |
| **vocabulary.md** | モックの書き方（L01〜L31 と宣言の一覧）。**モックをどう書くか** |

モックの書き方に触れる箇所は、ここでは要点だけ書いて `vocabulary.md` の節番号を指す。
詳細を両方に書くと必ずズレる（実測: 命名規則・タブ分類・繰り返し・共通領域の判定の
4箇所が、実装が変わったあとも旧方式のまま残っていた）。

## プロジェクト前提
- WordPress 6.5+ / PHP 8.1+ / Classicテーマ（ブロックテーマ・FSEは対象外）
- 必須プラグイン: Advanced Custom Fields（無料版）/ Safe SVG / Contact Form 7
- 言語: 日本語単一 / 本番: エックスサーバー / 開発: Local

## ACF生成ルール

**フィールドの決め方はモック側の宣言で決まる。詳細は `rules/vocabulary.md` を見ること。**
ここには「どの案件でも変わらない約束」だけを書く。

- 全編集対象要素をACFフィールド化する。**編集対象かどうかはモックの `data-acf` が決める**
- 名前は人が意味ベースで付ける（`data-acf` の値がそのままフィールド名になる）。
  機械が `{セクション名}_{要素種別}_{連番}` を組み立てることはしない。
  したがって「機械命名 → 意味名へのリネーム」工程は発生しない
- 名前は ASCII 小文字・数字・アンダースコアのみ。**数字始まりは禁止**（vocabulary.md L03）。
  PHP変数・ACFキー・JS変数として使えるようにするため
- ページIDは mockup フォルダからの相対パスで生成する。index.html はディレクトリ名に畳む
  （例: about/index.html → about、center/biotope.html → center_biotope）。ルート直下の index.html は index
- フィールドは**本文と装飾の2つに分かれる**。装飾は `data-deco` または `aria-hidden="true"`
  （vocabulary.md 2.4）。本文の区切りは `data-section` が持つ
- デフォルト値: mockup内の値をACFデフォルト値として登録する
- 繰り返しは `data-loop` で CPT のループにする（vocabulary.md 3章）。
  件数の上限は無い。同じ中身の子を複数持つ形（カルーセル等）は `data-loop-repeat` で表す

## ナビ・フォーム・メタ
- nav要素はWPカスタムメニューへ変換する
- form要素はContact Form 7のショートコードへ置換する
- OGP / Twitter Card / 基本meta（title, description）を出力する。SEOプラグインに依存しない
- `<title>` は WordPress に組み立てさせる。**モックの文字列を逐語で焼かない。**
  焼くと、お客様が管理画面から作った新規ページが規則の外に落ちて、
  そのページだけ区切りが WP 既定（`–`）になる。渡す材料は4つ:
  区切り文字（`.ichiki.json` の `title_separator`、既定 `" | "`）/ サイト名 / タグライン
  （どちらもトップの `<title>` を区切りで割って得る）/ CPT ラベル（一覧ページの `<title>` から）
- モックの `<title>` が案件の区切り文字とサイト名で書かれているかを全ページ検査し、
  違えば停止する。**モックを書くときに `.ichiki.json` を見る必要はない**（検査が教える）

## 共通領域の扱い
- 共通領域は**モックの `data-common` 宣言で決まる**（vocabulary.md 4章）。多数決や一致率での検出はしない。scan は宣言された id を集め、`common` キーとして acf-map.yaml に1回だけ出力する。各ページからは該当セクションを除外する。
- Phase 1 で WPテーマ化する際、`common` のフィールドを共通テンプレ（header.php / footer.php）に配置し、共通の nav はカスタムメニューに名寄せする。
- 同じ `data-common` の中身は全ページで一致していること（vocabulary.md L09 が検査する）。例外は現在ページを示す class だけ（`data-nav-current`）。


## アクセシビリティ
- WCAG 2.0 AA。自動検出できる範囲を対象とする
- pa11y-ci + axe-core を GitHub Actions で実行し、AA違反があればPRをマージブロックする
- 自動で拾えない項目（alt文言の妥当性、読み上げ順序の意味）は人手レビューで別途担保する

## 成果物
- テスト仕様書（Markdown + PDF、1画面1テスト、YES/NO判定）を自動出力する
- 本番リリース手順書（Markdown、エックスサーバー向け）を自動出力する

## 出力契約（ファイル構成）
テーマは次の構成で生成する。案件ごとに崩さない。
- functions.php（テーマ設定・CPT登録・メニュー・acf読込・enqueue・画像sideload）
- header.php / footer.php（共通領域。common フィールドを配置）
- front-page.php（トップ）
- page-<slug>.php（固定ページ）
- archive-<cpt>.php / single-<cpt>.php（CPTの一覧・詳細）
- inc/acf-<slug>.php（ACFフィールドグループ登録。acf_add_local_field_group）
- inc/defaults-<slug>.php（デフォルト値 = mockup値のフォールバック）
- inc/seed-posts.php（初期投入。必要時のみ）
- assets/（mockup由来の css / js / images / svg）

## 型

**型はモック側で決まる。詳細は `rules/vocabulary.md` 2.1節。**
タグから導出できるものは省略でき、できないタグは `data-acf-type` が必須。
Phase 1 で型を判断し直す工程は無い（acf-map.yaml の型がそのまま使われ、
食い違えば変換器が停止する）。

- 有効な型は `text` / `textarea` / `wysiwyg` / `url` / `image` の5つ
- `image` の return_format は array に統一する
- `wysiwyg` は `<p>` に宣言できない（vocabulary.md 2.7 / L31）

## トップページ
- `data-page="front"` を宣言したページが front-page.php になる（vocabulary.md 1章）。
  slug からの推測はしない
- 宣言が無い・複数ある → 変換器が停止する

## ナビゲーション（リンク解決）
- `data-nav` を register_nav_menus() + wp_nav_menu() で出力する（vocabulary.md 5章）。
  **モックに書かれた DOM の形をそのまま再現する**（形ごとに Walker を生成する）
- モック内ファイルへの相対パスは、生成ページのパーマリンクへ対応付ける。
  **`data-nav` の中も外も同じ**（nav の中のリンク切れは lint L30 が検査する）
- 外部URL・アンカー・mailto: はそのまま
- 同じ `data-nav` の値は同じメニュー。値が違えば別メニュー
- メニュー項目は**参照型**（page_id / post_type_archive 等）で登録する。custom リンクにしない。
  お客様が管理画面から編集できなくなり、現在ページの判定も効かなくなるため

## フォーム（CF7置換）
- forms を Contact Form 7 のショートコードに置換する
- 送信先は CLAUDE.md の「## フォーム設定」。未指定時は admin_email、自動返信なし
- 未指定時はリリース手順書に「送信先を設定」と明記する

## 画像（2方式）
- 差し替え画像（スライド等）→ フォールバック表示。ACF image型、instructions に mockup 画像URLを明記、テンプレで「空欄なら assets/ の mockup 画像を表示」
- 自動投入（CPTヘッダー等）→ sideload で元サイト画像をメディアに登録
- ACF image型に文字列デフォルトは設定できないため、デフォルト表示はテンプレ側フォールバックで行う

## 作法
- フィールドに L1 向けの instructions（記入例・改行ルール等）を付ける
- 本文エディタが不要なテンプレでは hide_on_screen に the_content を入れ、ACFのみで編集させる
- ACF PRO 専用機能（Repeater・Flexible Content・オプションページ）に依存しない
