# Ichiki 固定ルール（mockup→WordPress）

<!-- 全案件共通。案件用CLAUDE.mdから @import される。ここは案件ごとに書き換えない -->

## プロジェクト前提
- WordPress 6.5+ / PHP 8.1+ / Classicテーマ（ブロックテーマ・FSEは対象外）
- 必須プラグイン: Advanced Custom Fields（無料版）/ Safe SVG / Contact Form 7
- 言語: 日本語単一 / 本番: エックスサーバー / 開発: Local

## ACF生成ルール
- 全編集対象要素をACFフィールド化する
- 命名規則: `{セクション名}_{要素種別}_{連番}`（連番は同種が複数あるときだけ付与。例: hero_title, features_icon_1）
- 数字始まりのセクション名は `sec_` を前置する（例: id="2024" → sec_2024_title）。ACF/PHPのキー・JS変数として使えるようにするため
- ページIDは mockup フォルダからの相対パスで生成する。index.html はディレクトリ名に畳む（例: about/index.html → about、center/biotope.html → center_biotope）。ルート直下の index.html は index
- タブ分類:
  - ①メインコンテンツ: h1〜h3・p・メイン領域のimg（初期展開）
  - ②セクション別: セクション内の繰り返し要素・サブ画像・機能アイコンSVG（初期展開）
  - ③装飾要素: 要素または祖先が `aria-hidden="true"`、またはclassに `bg-/pattern-/deco-` を含む h1〜h6/p/img/svg（折りたたみ）
- デフォルト値: mockup内の値をACFデフォルト値として登録する
- 繰り返し要素は固定数前提。連番フィールドで表現する（可変数のセクションは対象外、または案件CLAUDE.mdの除外で手動指定）

## ナビ・フォーム・メタ
- nav要素はWPカスタムメニューへ変換する
- form要素はContact Form 7のショートコードへ置換する
- OGP / Twitter Card / 基本meta（title, description）を出力する。SEOプラグインに依存しない

## 共通領域の扱い
- Phase 0 の scan は、全ページの半数以上で完全一致するセクション（footer・header・cta等）を検出し、`common` キーとして acf-map.yaml に1回だけ出力する。各ページからは該当セクションを除外する。
- Phase 1 で WPテーマ化する際、`common` のフィールドを共通テンプレ（header.php / footer.php）に配置し、共通の nav はカスタムメニューに名寄せする。
- 共通化の判定は「セクションID＋各フィールドの名前と値」の署名による完全一致。閾値はページ数の半数（切り上げ、最低2）。

## セクション分類の既知の弱点（人手レビュー対象）
- セクション名は「id を持つ祖先 → セクションタグの祖先 → section風クラスの祖先」の順で決まる。意図しないラッパーを拾うことがあるため、`/setup` 手順4で命名を確認する。
- hero/main 判定はクラス・id の部分一致（hero/main/top/kv/mv）で行う。`topic` `main-visual` 以外の語に誤マッチする余地があるため、main タブの分類は目視確認する。
- id も意味のある class も無いセクション（<section style="..."> 等）は、タグ名＋ページ内DOM出現順の連番で区別する（例: section_3、section_8）。後処理（Claude Code）が中身の見出しを見て意味名にリネームする
- class 名がタグ名と同じ（例: <section class="section white">）場合、section は意味名とみなさず次の class（white）を採用するか連番にフォールバックする

## アクセシビリティ
- WCAG 2.0 AA。自動検出できる範囲を対象とする
- pa11y-ci + axe-core を GitHub Actions で実行し、AA違反があればPRをマージブロックする
- 自動で拾えない項目（alt文言の妥当性、読み上げ順序の意味）は人手レビューで別途担保する

## 成果物
- テスト仕様書（Markdown + PDF、1画面1テスト、YES/NO判定）を自動出力する
  出力カテゴリ（ページ別）: 表示確認 / ACF差し替え / フォーム送信 / リンク遷移 / レスポンシブ / アクセシビリティ簡易チェック
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

## 型マッピング（Phase 1 で適用）
acf-map.yaml の type（text/textarea/image の3型）を、意味に応じて次に変換する:
- 見出し（h1〜h3）→ text
- 短い1〜2文（p）→ textarea
- リッチな本文（h2配下のまとまった段落・リスト等）→ wysiwyg
- 単体URL（リンク先・公式サイト等）→ url
- 画像（img）→ image（return_format は array に統一）
- ラベルを持つ定型項目（住所・料金・営業時間等）→ text
- 判断はお手本に倣う

## トップページ
- index / home / top / front のいずれかの slug を front-page に割り当てる
- 該当なし・複数 → CLAUDE.md の「## トップページ」で指定。指定なければ止めて確認する（自動推測しない）

## ナビゲーション（リンク解決）
- nav を register_nav_menus() + wp_nav_menu() で出力する
- links[].href が mockup内ファイル（about.html 等）なら、生成ページのパーマリンクへ対応付ける
- 外部URL・アンカー・mailto: はそのまま
- 重複する nav は1つの共通メニューに名寄せする

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
