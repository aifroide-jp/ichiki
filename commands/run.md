---
description: acf-map.yaml を入力に WordPress テーマを構築する（Ichiki Phase 1）
argument-hint: [page-slug or "all"]
allowed-tools: Bash(*), Read, Write, Edit
---

# /run — Ichiki Phase 1（Claude Code 後処理）

acf-map.yaml と固定ルール（@.claude/ichiki/rules/ichiki.md）とお手本を入力に、WordPress テーマを1ページずつ構築する。

引数:

- `$1` = 構築するページの slug（任意。省略時は全ページを順に構築する）

## 前提確認

1. `acf-map.yaml` が案件リポ直下にあることを確認する。無ければ `/setup` を先に実行する。
2. `CLAUDE.md` が案件リポ直下にあることを確認する。
3. `.ichiki.json` が案件リポ直下にあり、`theme_dir`（絶対パス）と `site_url` が設定済みであることを確認する。未設定なら `/setup` を再実行して生成し、値を埋めてから進む。
4. Local で WordPress が起動しており、`theme_dir` のパスにテーマディレクトリが存在することを確認する。
5. ACF・Contact Form 7・Safe SVG プラグインが有効化されていることを確認する。確認はステップ 5 の起動コマンド出力で担保する（ここでは止めない）。

## ステップ 1: 全体準備（初回のみ）

- acf-map.yaml を読み込み、ページ一覧・common（共通領域）・nav・forms を把握する。
- functions.php を生成する（テーマ設定・CPT登録・メニュー登録・acf読込・enqueue・sideload処理）。
- common セクションのフィールドを header.php / footer.php に配置する。フッタ等の編集対象は、無料版で成立する方式（専用設定ページ or customizer）で編集可能にする。お手本の方式に倣う。
- nav を register_nav_menus() ＋ wp_nav_menu() で出力する。重複する nav は1つの共通メニューに名寄せする。
- mockup の CSS / JS / images / SVG を assets/ に配置し functions.php で enqueue する。
- 各 mockup HTML の `<style>` ブロックを **ページごとに別ファイル** として抽出し `assets/css/{template-slug}.css` に保存する。
  - ファイル名はテンプレート名に合わせる（例: `front-page.css`、`page-contact.css`、`single-nkk_spot.css`）。
  - background-image の相対URLは CSS ファイルからの相対パスに修正する（`url('images/` → `url('../images/`）。
  - `*, html, body, img, a, ul, .container` 等の共通リセット・ベースは除外し、コンポーネント固有のセレクタのみ書き出す。
  - `:root { --color-* }` など mockup 固有の CSS 変数も各ページの CSS ファイルに含めてよい（ページ固有 CSS は該当ページにしか読み込まれないので干渉しない）。
- functions.php で **テンプレートスラッグによる自動 enqueue** を実装する。
  `template_include` フィルタでスラッグをキャプチャし、`wp_enqueue_scripts`（priority 20）で `assets/css/{slug}.css` が存在すれば条件なしで enqueue する。
  これにより新しいページの CSS ファイルを追加するだけで自動的に読み込まれる。

## ステップ 2: ページ種別の判定

acf-map.yaml のページごとに種別を判定する。

- CLAUDE.md の「## ページ種別」に指定があれば優先する。
- 一覧・詳細を持つコンテンツ（拠点・事例・イベント・写真・スポット等）→ CPT で実装する。
- お知らせ等 → カテゴリ区分の投稿でもよい。
- 単発ページ → 固定ページとする。
- 判定できないものは固定ページに倒す。迷ったらユーザーに確認し、自動推測しない。

トップページ:

- index / home / top / front のいずれかの slug を front-page.php に割り当てる。
- 該当なし・複数ある → CLAUDE.md の「## トップページ」で指定する。指定が無ければ実装を止めて確認する。

## ステップ 3: テンプレートとACF定義の生成（1ページずつ）

`$1` で指定された slug（または全ページを順に）について、次のファイルを生成する。

出力ファイル:

- index.php（テンプレート階層の最終フォールバック。WordPress 必須）
- page-<slug>.php（固定ページ）or single-<cpt>.php ＋ archive-<cpt>.php（CPT）
- inc/acf-<slug>.php（ACFフィールドグループ登録。acf_add_local_field_group）
- inc/defaults-<slug>.php（デフォルト値 = mockup値のフォールバック）
- 必要時: inc/seed-posts.php（初期投入）

型マッピング:

- 見出し（h1〜h3）→ text
- 短い1〜2文（p）→ textarea
- リッチな本文（h2配下のまとまった段落・リスト等）→ wysiwyg
- 単体URL（リンク先・公式サイト等）→ url
- 画像（img）→ image（return_format は array に統一）
- ラベルを持つ定型項目（住所・料金・営業時間等）→ text
- 判断はお手本に倣う。

命名:

- acf-map.yaml の機械命名（spot_text_1 等）を意味ベースの名前（spot_address・spot_fee 等）にリネームする。
- 対応関係を field-map.json に **必ず** 記録する。省略するとカバレッジ照合が成立しない。

画像:

- ページ内の差し替え画像（スライド等）→ フォールバック表示。ACF image型フィールドの instructions に mockup 画像URLを明記し、テンプレで「空欄なら mockup 画像（assets/ 配置）を表示」する。
- CPTのヘッダー画像等で自動投入 → 元サイト画像を sideload してメディアに登録する。

作法:

- フィールドに L1 向けの instructions（記入例・改行ルール等）を付ける。
- 本文エディタが不要なテンプレでは hide_on_screen に the_content を入れ、ACFのみで編集させる。
- ファイル命名（page-<slug>.php、inc/acf-<slug>.php 等）を案件ごとに崩さない。

フォーム（forms があるページのみ）:

- forms を Contact Form 7 のショートコードに置換する。name/type/placeholder を CF7 フォームタグへ対応させる。
- 送信先は CLAUDE.md の「## フォーム設定」。未指定時は admin_email、自動返信なしの暫定とし、リリース手順書に「送信先を設定」と明記する。

ナビゲーション:

- links[].href が mockup内ファイル（about.html 等）の場合、生成ページのパーマリンクへ対応付ける。外部URL・アンカー・mailto: はそのまま使う。

## ステップ 4: 検収ゲート（各ページ生成後に実行）

以下を確認する。1つでも不合格なら修正して再チェック。

- field-map.json で acf-map.yaml の全フィールド（common 含む）が実装に対応しているか（欠落ゼロ）
- ファイル構成が契約どおりか（page-<slug>.php・inc/acf-<slug>.php 等が揃っている）
- php -l で全 PHP ファイルにエラーが無いか
- pa11y-ci（WCAG 2.0 AA）で違反が 0 件か

ゲートスクリプトが実装されている場合は実行する:

    node .claude/ichiki/bin/gate.js check   # 未実装の場合は上の項目を手動確認

全項目合格なら次のページへ進む。

## ステップ 5: 完了

全ページ・全CPTがゲートを通過したら、サマリーを報告する:

- 生成ページ数、CPT数
- field-map.json のフィールド数（acf-map.yaml との対応率）
- ゲート通過状況
- 残課題（送信先未設定のフォーム等）

続けて、**Local サイトシェルで実行する起動コマンドを必ず出力する**。
コマンドは acf-map.yaml の `plugins_required` と実際の theme slug・ページ ID を埋めた状態で提示する（プレースホルダーのまま渡さない）。

```bash
# 1. 必須プラグインのインストール（plugins_required の値を並べる）
wp plugin install advanced-custom-fields contact-form-7 safe-svg --activate

# 2. テーマ有効化
wp theme activate <theme-slug>

# 3. 初期データ（site-options ページ・CF7 フォーム）
wp eval-file wp-content/themes/<theme-slug>/inc/seed-posts.php

# 4. 固定ページ一括作成
# acf-map.yaml の pages から固定ページを展開する。
# front-page に対応するページは --porcelain で ID を変数に受け取る。
# blog（WP標準投稿一覧）に対応するページがあれば同様に受け取る。なければ BLOG_ID は不要。
FRONT_ID=$(wp post create --post_type=page --post_status=publish --post_title="<front_title>" --post_name=<front_slug> --porcelain)
# BLOG_ID=$(wp post create ...) ← blog ページがある案件のみ
wp post create --post_type=page --post_status=publish --post_title="..." --post_name=... --page_template=... --porcelain
# （残りページ数分）

# 5. フロントページ設定（blog ページが無い案件は page_for_posts の行を省く）
wp option update show_on_front page
wp option update page_on_front  $FRONT_ID
# wp option update page_for_posts $BLOG_ID

# 6. パーマリンク再構築
wp rewrite flush --hard
```

Phase 2（検収）に引き渡す準備が整ったことをユーザーに伝える。

## お手本

- お手本は CLAUDE.md の「## お手本」または rules/ichiki.md で指定されたファイル群を参照する。
- 構造・粒度・命名・instructions の付け方をお手本に倣う。
- お手本は無断で変えない。変えたら再現性の基準がずれるため検証し直す。

## 守ること

- acf-map.yaml を書き換えない。読み取り専用。
- field-map.json への対応記録を省かない。
- 出力契約のファイル構成・命名を案件ごとに崩さない。
- ACF PRO 専用機能（Repeater・Flexible Content・オプションページ）に依存しない。
- トップページを自動推測で割り当てない。判定できなければ止めて確認する。
- WCAG CI のマージブロックを無効化して通さない。
- 固定ルール（rules/ichiki.md）を書き換えない。案件固有情報は CLAUDE.md に書く。
